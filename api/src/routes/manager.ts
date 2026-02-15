import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";
import {
  findDriverByPhone,
  getDriversStatus,
  listParkDrivers,
  normalizePhoneForYandex,
  validateFleetCredentials,
  tryDiscoverParkId,
  fleetStatusToRussian,
  type FleetCredentials,
} from "../lib/yandex-fleet.js";

/** In-memory кэш ответа Fleet drivers (TTL 15 с) для снижения нагрузки при частых запросах. */
const fleetDriversCache = new Map<
  string,
  { drivers: Array<{ id: string; yandexDriverId: string; phone: string; name: string | null; balance?: number; workStatus?: string }>; meta: { source: "fleet"; count: number; hint?: string; rawCount?: number }; expires: number }
>();
function getFleetDriversCache(key: string): { drivers: unknown[]; meta: { source: "fleet"; count: number; hint?: string; rawCount?: number } } | null {
  const entry = fleetDriversCache.get(key);
  return entry && entry.expires > Date.now() ? { drivers: entry.drivers, meta: entry.meta } : null;
}
function setFleetDriversCache(
  key: string,
  payload: { drivers: Array<{ id: string; yandexDriverId: string; phone: string; name: string | null; balance?: number; workStatus?: string }>; meta: { source: "fleet"; count: number; hint?: string; rawCount?: number } },
  ttlMs: number
): void {
  fleetDriversCache.set(key, { ...payload, expires: Date.now() + ttlMs });
}

async function requireManager(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData) {
    reply.status(401).send({
      error: "Missing x-telegram-init-data",
      message: "Откройте приложение из Telegram — заголовок авторизации не передан.",
    });
    return;
  }
  if (!validateInitData(initData, config.botToken, 86400)) {
    reply.status(401).send({
      error: "Invalid initData",
      message: "Неверная или устаревшая подпись. Перезапустите Mini App из Telegram.",
    });
    return;
  }
  const { user } = parseInitData(initData);
  if (!user?.id) {
    reply.status(401).send({ error: "User not in initData", message: "В initData отсутствует user." });
    return;
  }
  (req as FastifyRequest & { telegramUserId?: number; telegramUser?: { first_name?: string; last_name?: string } }).telegramUserId = user.id;
  (req as FastifyRequest & { telegramUser?: { first_name?: string; last_name?: string } }).telegramUser = user;

  const nameFromTelegram =
    [user.first_name, user.last_name].filter((s) => s != null && String(s).trim() !== "").join(" ").trim() || null;
  const usernameFromTelegram =
    typeof user.username === "string" && user.username.trim() !== "" ? user.username.trim() : null;

  req.log.info({
    step: "requireManager",
    telegramUserId: user.id,
    fromInitData: { first_name: user.first_name, last_name: user.last_name, username: user.username },
    derived: { name: nameFromTelegram, telegramUsername: usernameFromTelegram },
  });

  let manager = await prisma.manager.findUnique({
    where: { telegramId: String(user.id) },
  });
  if (!manager) {
    manager = await prisma.manager.create({
      data: {
        telegramId: String(user.id),
        name: nameFromTelegram,
        telegramUsername: usernameFromTelegram,
      },
    });
  } else {
    const updates: { name?: string | null; telegramUsername?: string | null } = {};
    if (nameFromTelegram != null) updates.name = nameFromTelegram;
    if (usernameFromTelegram != null) updates.telegramUsername = usernameFromTelegram;
    if (Object.keys(updates).length > 0) {
      manager = await prisma.manager.update({
        where: { id: manager.id },
        data: updates,
      });
    }
  }
  (req as FastifyRequest & { managerId?: string }).managerId = manager.id;
}

function managerFleetCreds(manager: { yandexApiKey: string | null; yandexParkId: string | null; yandexClientId: string | null }): FleetCredentials | null {
  if (!manager.yandexApiKey || !manager.yandexParkId || !manager.yandexClientId) return null;
  return { apiKey: manager.yandexApiKey, parkId: manager.yandexParkId, clientId: manager.yandexClientId };
}

export async function managerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireManager);

  /**
   * GET /api/manager/me
   * Текущий пользователь из initData (имя + признак подключения Fleet).
   */
  app.get("/me", async (req, reply) => {
    const user = (req as FastifyRequest & { telegramUser?: { first_name?: string; last_name?: string } }).telegramUser;
    const telegramUserId = (req as FastifyRequest & { telegramUserId?: number }).telegramUserId;
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    let hasFleet = false;
    if (managerId) {
      const manager = await prisma.manager.findUnique({ where: { id: managerId } });
      hasFleet = Boolean(manager?.yandexApiKey);
    }
    app.log.info({ step: "manager/me", telegramUserId, managerId, hasFleet });
    return reply.send({
      telegramUserId,
      firstName: user?.first_name != null ? user.first_name : null,
      lastName: user?.last_name != null ? user.last_name : null,
      hasFleet,
    });
  });

  /**
   * POST /api/manager/connect-fleet
   * Body: { apiKey: string, parkId: string }
   * Проверяет ключ тестовым запросом к Fleet, сохраняет в Manager.
   */
  app.post<{ Body: { apiKey?: string; parkId?: string; clientId?: string } }>("/connect-fleet", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });

    const apiKey = (req.body as { apiKey?: string })?.apiKey?.trim();
    let parkId = (req.body as { parkId?: string })?.parkId?.trim();
    const clientIdRaw = (req.body as { clientId?: string })?.clientId?.trim();
    let discoveredParks: Array<{ id: string; name?: string }> | undefined;
    if (!apiKey) return reply.status(400).send({ error: "apiKey required", message: "Введите API-ключ" });
    if (!parkId) {
      app.log.info({ step: "connect-fleet", message: "Пытаюсь определить parkId по ключу" });
      const discovered = await tryDiscoverParkId(apiKey);
      if (discovered.parkId) {
        parkId = discovered.parkId;
        discoveredParks = discovered.parks;
        app.log.info({
          step: "connect-fleet",
          discoveredParkId: parkId.slice(0, 8) + "***",
          fromEndpoint: discovered.fromEndpoint,
          parksCount: discovered.parksCount,
        });
        if (discovered.parksCount != null && discovered.parksCount > 1) {
          app.log.warn({
            step: "connect-fleet",
            message: "Несколько парков по ключу, взят первый",
            parksCount: discovered.parksCount,
          });
        }
      } else {
        app.log.warn({
          step: "connect-fleet",
          message: "Не удалось определить parkId по ключу",
          fleetErrorCode: discovered.fleetCode,
          fleetErrorMessage: discovered.fleetMessage,
        });
        const baseMessage =
          "По этому API-ключу не удалось определить парк автоматически (Fleet API не вернул список парков или доступ запрещён). Введите ID парка из кабинета fleet.yandex.ru (Настройки → Общая информация) в поле «ID парка» и нажмите «Подключить» снова.";
        const hint = discovered.fleetMessage
          ? ` Ответ Fleet: ${discovered.fleetMessage.slice(0, 150)}`
          : "";
        return reply.status(400).send({
          error: "parkId required",
          code: "parkId required",
          message: baseMessage + hint,
        });
      }
    }

    const clientId = clientIdRaw && clientIdRaw.length > 0 ? clientIdRaw : `taxi/park/${parkId}`;
    app.log.info({
      step: "connect-fleet:start",
      managerId,
      parkId,
      clientId,
      apiKeyPrefix: apiKey.slice(0, 6) + "...",
    });
    const validation = await validateFleetCredentials(apiKey, parkId, clientId);
    if (!validation.ok) {
      app.log.warn({
        step: "connect-fleet:fleet_validation_failed",
        managerId,
        parkId,
        fleetStatus: validation.statusCode,
        fleetCode: validation.fleetCode,
        fleetMessage: validation.fleetMessage,
        message: validation.message?.slice(0, 200),
      });
      app.log.warn({ step: "connect-fleet:fleet_error_details", details: validation.message });
      const humanMessage = fleetStatusToRussian(validation.statusCode);
      const fleetHint =
        validation.fleetCode || validation.fleetMessage
          ? [validation.fleetCode, validation.fleetMessage].filter(Boolean).join(" — ")
          : undefined;
      return reply.status(400).send({
        error: "Invalid Fleet credentials",
        code: "FLEET_VALIDATION_FAILED",
        step: "fleet_validation",
        fleetStatus: validation.statusCode,
        fleetCode: validation.fleetCode,
        fleetMessage: validation.fleetMessage,
        fleetHint,
        message: humanMessage,
        details: validation.message,
      });
    }
    await prisma.manager.update({
      where: { id: managerId },
      data: { yandexApiKey: apiKey, yandexParkId: parkId, yandexClientId: clientId },
    });
    app.log.info({
      step: "connect-fleet:success",
      managerId,
      parkId: parkId.slice(0, 8) + (parkId.length > 8 ? "***" : ""),
      clientIdPrefix: clientId.slice(0, 20) + (clientId.length > 20 ? "..." : ""),
    });
    const successPayload: { success: true; message: string; parks?: Array<{ id: string; name?: string }> } = {
      success: true,
      message: "Парк успешно подключён!",
    };
    if (discoveredParks != null && discoveredParks.length > 1) {
      successPayload.parks = discoveredParks;
    }
    return reply.send(successPayload);
  });

  /**
   * POST /api/manager/link-driver
   * Body: { phone: string }
   * Ищет водителя в Яндексе по телефону, создаёт DriverLink для текущего менеджера.
   */
  app.post<{ Body: { phone?: string } }>("/link-driver", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });

    const manager = await prisma.manager.findUnique({ where: { id: managerId } });
    const creds = manager ? managerFleetCreds(manager) : null;
    if (!creds) {
      return reply.status(400).send({ error: "Fleet not connected", message: "Сначала подключите Yandex Fleet (API-ключ и ID парка)." });
    }

    const phone = (req.body as { phone?: string })?.phone;
    if (!phone || typeof phone !== "string") return reply.status(400).send({ error: "phone required" });

    const normalized = normalizePhoneForYandex(phone);
    let driver;
    try {
      driver = await findDriverByPhone(normalized, creds);
    } catch (e) {
      app.log.error(e);
      return reply.status(502).send({ error: "Yandex Fleet API error", message: (e as Error).message });
    }

    if (!driver) {
      return reply.status(404).send({ error: "Driver not found in Yandex", message: "Водитель с таким номером не найден в диспетчерской." });
    }

    const link = await prisma.driverLink.upsert({
      where: {
        managerId_yandexDriverId: { managerId, yandexDriverId: driver.yandexId },
      },
      create: {
        managerId,
        yandexDriverId: driver.yandexId,
        driverPhone: driver.phone,
        cachedName: driver.name || undefined,
      },
      update: {
        driverPhone: driver.phone,
        cachedName: driver.name || undefined,
      },
    });

    return reply.send({
      ok: true,
      driverLinkId: link.id,
      driver: {
        yandexId: driver.yandexId,
        name: driver.name,
        phone: driver.phone,
        balance: driver.balance,
        workStatus: driver.workStatus,
      },
    });
  });

  /**
   * GET /api/manager/drivers
   * Список исполнителей парка из Yandex Fleet API (driver-profiles/list по park.id).
   * Если Fleet подключён — возвращаем полный список водителей парка; иначе — только привязанных по телефону (DriverLink).
   */
  app.get("/drivers", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) {
      req.log.warn({ step: "drivers_list", error: "manager_not_found" });
      return reply.status(401).send({ error: "Manager not found" });
    }

    const manager = await prisma.manager.findUnique({ where: { id: managerId } });
    const creds = manager ? managerFleetCreds(manager) : null;
    const hasCreds = Boolean(creds);

    req.log.info({
      step: "drivers_list",
      managerId,
      hasCreds,
      parkId: creds ? `${creds.parkId.slice(0, 4)}***` : null,
      queryParkId: creds ? `${creds.parkId.slice(0, 4)}***` : null,
    });

    if (creds) {
      try {
        const FLEET_DRIVERS_CACHE_TTL_MS = 15_000;
        const cacheKey = `drivers:${managerId}:${creds.parkId}`;
        const cached = getFleetDriversCache(cacheKey);
        if (cached && cached.expires > Date.now()) {
          req.log.info({ step: "drivers_list", source: "fleet", cacheHit: true, parkDriversCount: cached.drivers.length });
          const meta = cached.meta;
          if (meta.count === 0 && (meta.hint == null || String(meta.hint).trim() === "")) {
            meta.hint =
              "Fleet API вернул 0 водителей. Проверьте ID парка и права ключа в fleet.yandex.ru. Ожидаемые ключи ответа: driver_profiles, limit, offset (или data с ними внутри).";
          }
          return reply.send({ drivers: cached.drivers, meta });
        }

        let parseDiagnostics: { rawDriverProfilesLength: number; parsedDriversCount: number; firstItemSample?: string; driversWithoutName?: number } | null = null;
        let fleetResponseTopLevelKeys: string[] = [];
        const parkDrivers = await listParkDrivers(creds, {
          onRequestParams: (p) => {
            req.log.info({
              step: "drivers_list",
              source: "fleet",
              requestedFields: JSON.stringify({ driver_profile: p.fields.driver_profile ?? [], account: p.fields.account ?? [] }),
              queryParkId: `${p.queryParkId.slice(0, 4)}***`,
              limitOffset: `${p.limit}/${p.offset}`,
            });
          },
          onEmptyResponseKeys: (keys) => {
            fleetResponseTopLevelKeys = keys;
            const wrappedInData = keys.some((k) => k === "fleetResponseWrappedInData:true");
            if (wrappedInData) {
              req.log.info({ step: "drivers_list", source: "fleet", fleetResponseWrappedInData: true });
            }
            req.log.warn({
              step: "drivers_list",
              source: "fleet",
              fleetResponseTopLevelKeys: keys,
              hint: "Fleet вернул 200, но список пуст — проверьте структуру ответа по ключам выше",
            });
          },
          onParseDiagnostics: (d) => {
            parseDiagnostics = d;
            req.log.info({
              step: "drivers_list",
              source: "fleet",
              fleetStatus: d.fleetStatus,
              rawDriverProfilesLength: d.rawDriverProfilesLength,
              parsedDriversCount: d.parsedDriversCount,
              ...(d.skippedCount != null && d.skippedCount > 0 && { skippedCount: d.skippedCount, skippedNoId: d.skippedNoId }),
            });
            if (d.firstItemSample != null) {
              req.log.warn({
                step: "drivers_list",
                source: "fleet",
                firstItemSample: d.firstItemSample,
                hint: "Элементы пришли, но ни один не прошёл парсинг — см. firstItemSample",
              });
            }
            if (d.driversWithoutName != null && d.driversWithoutName > 0) {
              req.log.info({ step: "drivers_list", source: "fleet", driversWithoutName: d.driversWithoutName });
            }
          },
        });
        req.log.info({
          step: "drivers_list",
          source: "fleet",
          parkDriversCount: parkDrivers.length,
          ...(parkDrivers.length === 0 && { hint: "fleet_returned_empty_list_check_park_id_and_key_scope" }),
        });
        const drivers = parkDrivers.map((d) => ({
          id: d.yandexId,
          yandexDriverId: d.yandexId,
          phone: d.phone,
          name: d.name,
          balance: d.balance,
          workStatus: d.workStatus,
        }));
        const rawCount = parseDiagnostics?.rawDriverProfilesLength ?? 0;
        const parsedCount = parkDrivers.length;
        const hintSuffix = " Если проблема сохраняется — пришлите скрин кабинета и логи бэкенда разработчику.";
        const noNameSuffix = parseDiagnostics?.driversWithoutName && parseDiagnostics.driversWithoutName > 0
          ? ` Показаны водители без ФИО (${parseDiagnostics.driversWithoutName} шт.).`
          : "";
        const keysForHint = fleetResponseTopLevelKeys.filter((k) => k !== "fleetResponseWrappedInData:true");
        let hint = "";
        if (rawCount === 0) {
          hint =
            "Fleet API вернул 0 водителей для этого парка. Проверьте в fleet.yandex.ru:\n" +
            "• Правильный ли ID парка\n" +
            "• Есть ли водители в парке\n" +
            "• Права у API-ключа на чтение списка водителей\n" +
            hintSuffix;
          if (keysForHint.length > 0) {
            hint += `\nКлючи ответа Fleet: ${keysForHint.join(", ")}`;
          } else {
            hint += "\nКлючи ответа Fleet: пустой объект";
          }
          hint += "\nОжидаемые ключи: driver_profiles, limit, offset (или data с ними внутри).";
        } else if (rawCount > 0 && parsedCount === 0) {
          hint =
            `Fleet вернул ${rawCount} записей, но ни одна не распознана (неверный формат). ` +
            `Проверьте структуру в логах (firstItemSample) и пришлите разработчику.${hintSuffix}`;
        } else if (parsedCount > 0 && parsedCount < rawCount) {
          hint = `Fleet вернул ${rawCount} записей, показано только ${parsedCount} (часть не распознана).${hintSuffix}`;
        } else {
          hint = "";
        }
        if (hint && noNameSuffix) hint += noNameSuffix;
        const responsePayload = {
          drivers,
          meta: {
            source: "fleet" as const,
            count: parkDrivers.length,
            hint: hint || undefined,
            ...(parseDiagnostics != null && { rawCount: parseDiagnostics.rawDriverProfilesLength }),
          },
        };
        setFleetDriversCache(cacheKey, responsePayload, FLEET_DRIVERS_CACHE_TTL_MS);
        return reply.send(responsePayload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isAuthError = /Fleet API error (401|403)/.test(msg) || msg.includes("401") || msg.includes("403");
        req.log.error({
          step: "drivers_list",
          source: "fleet",
          error: "listParkDrivers_failed",
          message: msg.slice(0, 300),
          credsCleared: isAuthError,
        });
        if (managerId && isAuthError) {
          await prisma.manager.update({
            where: { id: managerId },
            data: { yandexApiKey: null, yandexParkId: null, yandexClientId: null },
          });
          return reply.send({
            drivers: [],
            meta: {
              source: "fleet",
              count: 0,
              credsInvalid: true,
              hint: "Ключ или парк изменились. Подключите парк заново: введите API-ключ.",
            },
          });
        }
        return reply.status(502).send({
          error: "Yandex Fleet API error",
          message: msg,
          code: "FLEET_DRIVERS_ERROR",
        });
      }
    }

    const links = await prisma.driverLink.findMany({
      where: { managerId },
      orderBy: { createdAt: "desc" },
    });
    req.log.info({
      step: "drivers_list",
      source: "driver_link",
      linksCount: links.length,
    });
    const drivers = links.map((l) => ({
      id: l.id,
      yandexDriverId: l.yandexDriverId,
      phone: l.driverPhone,
      name: l.cachedName ?? null,
      balance: undefined,
      workStatus: undefined,
    }));
    const hint =
      links.length === 0
        ? "Парк не подключён (нет API-ключа). Подключите парк в онбординге или в Кабинете."
        : undefined;
    return reply.send({
      drivers,
      meta: { source: "driver_link" as const, count: links.length, hint },
    });
  });
}
