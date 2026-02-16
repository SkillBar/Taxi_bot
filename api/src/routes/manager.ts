import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";
import { decryptCiphertext, encryptPlaintext } from "../lib/encrypt.js";
import {
  findDriverByPhone,
  getDriversStatus,
  listParkDrivers,
  normalizePhoneForYandex,
  validateFleetCredentials,
  fleetStatusToRussian,
  getFleetList,
  getDriverProfileById,
  getContractorBlockedBalance,
  getDriverWorkRules,
  updateDriverProfile,
  updateCar,
  type FleetCredentials,
  type FleetListType,
} from "../lib/yandex-fleet.js";

/** In-memory кэш ответа Fleet drivers (TTL 15 с) для снижения нагрузки при частых запросах. */
const fleetDriversCache = new Map<
  string,
  { drivers: Array<{ id: string; yandexDriverId: string; phone: string; name: string | null; middle_name?: string | null; balance?: number; workStatus?: string; current_status?: string; car_id?: string | null }>; meta: { source: "fleet"; count: number; hint?: string; rawCount?: number }; expires: number }
>();
function getFleetDriversCache(key: string): { drivers: unknown[]; meta: { source: "fleet"; count: number; hint?: string; rawCount?: number } } | null {
  const entry = fleetDriversCache.get(key);
  return entry && entry.expires > Date.now() ? { drivers: entry.drivers, meta: entry.meta } : null;
}
function setFleetDriversCache(
  key: string,
  payload: { drivers: Array<{ id: string; yandexDriverId: string; phone: string; name: string | null; middle_name?: string | null; balance?: number; workStatus?: string; current_status?: string; car_id?: string | null }>; meta: { source: "fleet"; count: number; hint?: string; rawCount?: number } },
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

  try {
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
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; meta?: { column?: string } };
    const isSchemaOutdated =
      err.code === "P2022" && err.meta?.column === "Manager.fleetParkId" ||
      (typeof err.message === "string" && err.message.includes("fleetParkId") && err.message.includes("does not exist"));
    if (isSchemaOutdated) {
      req.log.warn({ step: "requireManager", error: "schema_outdated", prismaCode: err.code, message: (err.message ?? "").slice(0, 120) });
      return reply.status(503).send({
        error: "schema_outdated",
        code: "SCHEMA_OUTDATED",
        message:
          "База данных не обновлена. Администратору: выполните скрипт миграции в Neon (SQL Editor) для той БД, что в Vercel. См. docs/VERCEL_DB_MIGRATE.md",
      });
    }
    throw e;
  }
}

function managerFleetCreds(manager: { yandexApiKey: string | null; yandexParkId: string | null; yandexClientId: string | null }): FleetCredentials | null {
  if (!manager.yandexApiKey || !manager.yandexParkId || !manager.yandexClientId) return null;
  return { apiKey: manager.yandexApiKey, parkId: manager.yandexParkId, clientId: manager.yandexClientId };
}

/** Нормализация номера для поиска в БД: только цифры (без +). Экспорт для bot. */
export function normalizePhoneForDb(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length >= 10 && digits.startsWith("7")) return digits;
  return digits;
}

/** Результат привязки номера: notInBase = true, если номера нет в базе агентов (доступ не даём). */
export type ApplyPhoneResult = { managerId: string; hasFleet: boolean; notInBase?: false } | { managerId?: string; hasFleet: false; notInBase: true };

/**
 * Привязать номер к менеджеру только если номер уже есть в базе (Manager.phone).
 * Если номера нет — не создаём запись, не даём доступ; возвращаем notInBase: true.
 */
export async function applyPhoneToManager(
  telegramUserId: string,
  phone: string,
  app: FastifyInstance
): Promise<ApplyPhoneResult> {
  const defaultPark = await ensureDefaultFleetPark(app);
  const normalized = normalizePhoneForDb(phone);
  const byTelegram = await prisma.manager.findUnique({ where: { telegramId: telegramUserId } });
  const byPhone = await prisma.manager.findFirst({ where: { phone: normalized } });

  if (!byPhone) {
    if (byTelegram) {
      await prisma.manager.update({
        where: { id: byTelegram.id },
        data: { phone: normalized },
      });
      app.log.info({ step: "applyPhoneToManager", action: "phone_updated_not_in_base", managerId: byTelegram.id });
    } else {
      app.log.info({ step: "applyPhoneToManager", action: "not_in_base", phonePrefix: normalized.slice(0, 4) + "***" });
    }
    return { hasFleet: false, notInBase: true };
  }

  let manager: { id: string; fleetParkId: number | null; yandexApiKey: string | null; yandexParkId: string | null; yandexClientId: string | null };
  if (byTelegram && byPhone.id !== byTelegram.id) {
    await prisma.driverLink.deleteMany({ where: { managerId: byTelegram.id } });
    await prisma.manager.delete({ where: { id: byTelegram.id } });
    manager = await prisma.manager.update({
      where: { id: byPhone.id },
      data: { telegramId: telegramUserId, phone: byPhone.phone ?? normalized, fleetParkId: byPhone.fleetParkId ?? defaultPark?.id ?? null },
    });
    app.log.info({ step: "applyPhoneToManager", action: "merged", managerId: manager.id });
  } else {
    manager = await prisma.manager.update({
      where: { id: byPhone.id },
      data: { telegramId: telegramUserId, phone: byPhone.phone ?? normalized, fleetParkId: byPhone.fleetParkId ?? defaultPark?.id ?? null },
    });
    app.log.info({ step: "applyPhoneToManager", action: "linked_telegram", managerId: manager.id });
  }
  const creds = await getManagerFleetCreds(manager.id);
  const hasFleet = Boolean(creds?.apiKey && creds?.parkId && creds?.clientId);
  return { managerId: manager.id, hasFleet };
}

const DEFAULT_PARK_DISPLAY_NAME = "Мой Таксопарк";

/** Возвращает дефолтный парк (по displayName или первый). Создаёт из env, если ещё нет. Экспорт для bot/set-phone. */
export async function ensureDefaultFleetPark(app: FastifyInstance): Promise<{ id: number; parkId: string; clientId: string; apiKeyEnc: string } | null> {
  const parkId = config.yandexParkId?.trim();
  const clientId = config.yandexClientId?.trim();
  const apiKey = config.yandexApiKey?.trim();
  if (!parkId || !clientId || !apiKey) return null;
  let park = await prisma.fleetPark.findFirst({ where: { displayName: DEFAULT_PARK_DISPLAY_NAME } });
  if (park) return park;
  park = await prisma.fleetPark.findFirst({ orderBy: { id: "asc" } });
  if (park) return park;
  park = await prisma.fleetPark.create({
    data: {
      parkId,
      clientId,
      apiKeyEnc: encryptPlaintext(apiKey),
      displayName: DEFAULT_PARK_DISPLAY_NAME,
    },
  });
  app.log.info({ step: "ensureDefaultFleetPark", created: park.id, parkId: park.parkId.slice(0, 8) + "***" });
  return park;
}

/** Creds из FleetPark (приоритет) или из полей Manager (legacy). Экспорт для draft.ts. */
export async function getManagerFleetCreds(managerId: string): Promise<FleetCredentials | null> {
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    include: { fleetPark: true },
  });
  if (!manager) return null;
  if (manager.fleetPark) {
    try {
      const apiKey = decryptCiphertext(manager.fleetPark.apiKeyEnc);
      return {
        parkId: manager.fleetPark.parkId,
        clientId: manager.fleetPark.clientId,
        apiKey,
      };
    } catch (_) {
      return null;
    }
  }
  return managerFleetCreds(manager);
}

export async function managerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    const path = (req as { url?: string }).url ?? "";
    if (path.includes("register-by-phone")) {
      const initData = (req.headers["x-telegram-init-data"] as string) || "";
      if (!initData) {
        reply.status(401).send({ error: "Missing x-telegram-init-data", message: "Откройте приложение из Telegram." });
        return;
      }
      if (!validateInitData(initData, config.botToken, 86400)) {
        reply.status(401).send({ error: "Invalid initData", message: "Неверная или устаревшая подпись." });
        return;
      }
      const { user } = parseInitData(initData);
      if (!user?.id) {
        reply.status(401).send({ error: "User not in initData", message: "В initData отсутствует user." });
        return;
      }
      (req as FastifyRequest & { telegramUserId?: number }).telegramUserId = user.id;
      (req as FastifyRequest & { telegramUser?: { first_name?: string; last_name?: string } }).telegramUser = user;
      return;
    }
    await requireManager(req, reply);
  });

  /**
   * POST /api/manager/register-by-phone
   * Body: { phoneNumber: string }
   * Находит или создаёт Manager по номеру / telegramUserId, привязывает к дефолтному FleetPark.
   * Вызывается после шага «подтвердить номер» в онбординге — ключи подставляются автоматом.
   */
  app.post<{ Body: { phoneNumber?: string } }>("/register-by-phone", async (req, reply) => {
    const telegramUserId = (req as FastifyRequest & { telegramUserId?: number }).telegramUserId;
    if (telegramUserId == null) return reply.status(401).send({ error: "telegramUserId required" });

    const raw = (req.body as { phoneNumber?: string })?.phoneNumber;
    const phone = raw != null ? normalizePhoneForDb(String(raw).trim()) : "";
    if (!phone || phone.length < 10) {
      return reply.status(400).send({ error: "phoneNumber required", message: "Укажите номер телефона (10+ цифр)." });
    }

    const telegramIdStr = String(telegramUserId);
    const result = await applyPhoneToManager(telegramIdStr, phone, app);
    app.log.info({ step: "register-by-phone", managerId: result.managerId, hasFleet: result.hasFleet, notInBase: result.notInBase });
    if (result.notInBase) {
      return reply.status(403).send({
        error: "not_in_base",
        message: "Вашего номера нет в базе агентов. Обратитесь к администратору для регистрации.",
        notInBase: true,
      });
    }
    return reply.send({ success: true, hasFleet: result.hasFleet, managerId: result.managerId });
  });

  /**
   * GET /api/manager/me
   * Текущий пользователь из initData (имя + признак подключения Fleet).
   */
  app.get("/me", async (req, reply) => {
    const user = (req as FastifyRequest & { telegramUser?: { first_name?: string; last_name?: string } }).telegramUser;
    const telegramUserId = (req as FastifyRequest & { telegramUserId?: number }).telegramUserId;
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    let hasFleet = false;
    let welcomeMessage: string | null = null;
    if (managerId) {
      const manager = await prisma.manager.findUnique({ where: { id: managerId } });
      hasFleet = Boolean(manager?.fleetParkId ?? (manager?.yandexApiKey && manager?.yandexParkId && manager?.yandexClientId));
      const createdAt = (manager as { createdAt?: Date })?.createdAt;
      if (createdAt) {
        const createdAgo = Date.now() - createdAt.getTime();
        if (createdAgo < 5 * 60 * 1000) {
          welcomeMessage =
            "Ваш номер не был в базе. Вы подключены к парку по умолчанию. Обратитесь к администратору для привязки к другому парку.";
        }
      }
    }
    app.log.info({ step: "manager/me", telegramUserId, managerId, hasFleet });
    return reply.send({
      telegramUserId,
      firstName: user?.first_name != null ? user.first_name : null,
      lastName: user?.last_name != null ? user.last_name : null,
      hasFleet,
      ...(welcomeMessage && { welcomeMessage }),
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

    const existingCreds = await getManagerFleetCreds(managerId);
    if (existingCreds) {
      app.log.info({ step: "connect-fleet", message: "Парк уже подключён", managerId });
      return reply.send({ success: true, message: "Парк уже подключён." });
    }

    const apiKey = (req.body as { apiKey?: string })?.apiKey?.trim();
    let parkId = (req.body as { parkId?: string })?.parkId?.trim();
    let clientIdRaw = (req.body as { clientId?: string })?.clientId?.trim();
    if (!apiKey) return reply.status(400).send({ error: "apiKey required", message: "Введите API-ключ" });
    if (!parkId) {
      const defaultPark = await ensureDefaultFleetPark(app);
      if (defaultPark) {
        parkId = defaultPark.parkId;
        clientIdRaw = defaultPark.clientId;
        app.log.info({ step: "connect-fleet", message: "parkId подставлен из env (парк по умолчанию)", parkIdPrefix: parkId.slice(0, 8) + "***" });
      } else {
        return reply.status(400).send({
          error: "parkId required",
          code: "parkId required",
          message:
            "В настройках сервера не задан парк по умолчанию (YANDEX_PARK_ID и др.). Введите ID парка из кабинета fleet.yandex.ru (Настройки → Общая информация) в поле «ID парка» и нажмите «Подключить».",
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
    return reply.send({ success: true, message: "Парк успешно подключён!" });
  });

  /**
   * POST /api/manager/attach-default-fleet
   * Привязывает к текущему менеджеру дефолтный FleetPark (id=1 из env). Без ввода ключа.
   */
  app.post("/attach-default-fleet", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });

    const defaultPark = await ensureDefaultFleetPark(app);
    if (!defaultPark) {
      app.log.info({ step: "attach-default-fleet", reason: "default_not_configured" });
      return reply.status(400).send({
        error: "default_fleet_not_configured",
        message: "Преднастроенный парк не задан. Введите API-ключ вручную.",
      });
    }

    try {
      const apiKey = decryptCiphertext(defaultPark.apiKeyEnc);
      const validation = await validateFleetCredentials(apiKey, defaultPark.parkId, defaultPark.clientId);
      if (!validation.ok) {
        app.log.warn({ step: "attach-default-fleet", fleetStatus: validation.statusCode });
        return reply.status(400).send({
          error: "default_fleet_invalid",
          message: fleetStatusToRussian(validation.statusCode),
        });
      }
    } catch (_) {
      return reply.status(500).send({ error: "decrypt_failed", message: "Ошибка чтения ключа парка." });
    }

    await prisma.manager.update({
      where: { id: managerId },
      data: { fleetParkId: defaultPark.id },
    });
    app.log.info({ step: "attach-default-fleet:success", managerId, parkId: defaultPark.parkId.slice(0, 8) + "***" });
    return reply.send({ success: true, message: "Парк подключён!" });
  });

  /**
   * POST /api/manager/link-driver
   * Body: { phone: string }
   * Ищет водителя в Яндексе по телефону, создаёт DriverLink для текущего менеджера.
   */
  app.post<{ Body: { phone?: string } }>("/link-driver", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });

    const creds = await getManagerFleetCreds(managerId);
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

    const creds = await getManagerFleetCreds(managerId);
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
        if (cached) {
          req.log.info({ step: "drivers_list", source: "fleet", cacheHit: true, parkDriversCount: cached.drivers.length });
          const meta = cached.meta;
          if (meta.count === 0 && (meta.hint == null || String(meta.hint).trim() === "")) {
            meta.hint =
              "Fleet API вернул 0 водителей. Проверьте ID парка и права ключа в fleet.yandex.ru. Ожидаемые ключи ответа: driver_profiles, limit, offset (или data с ними внутри).";
          }
          return reply.send({ drivers: cached.drivers, meta });
        }

        let parseDiagnostics: { rawDriverProfilesLength?: number; parsedDriversCount?: number; firstItemSample?: string; driversWithoutName?: number } | null = null;
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
          middle_name: d.middle_name ?? null,
          balance: d.balance,
          workStatus: d.workStatus,
          current_status: d.current_status ?? undefined,
          car_id: d.car_id ?? null,
        }));
        type Diag = { rawDriverProfilesLength?: number; driversWithoutName?: number };
        const rawCount = (parseDiagnostics ? (parseDiagnostics as Diag).rawDriverProfilesLength : undefined) ?? 0;
        const parsedCount = parkDrivers.length;
        const hintSuffix = " Если проблема сохраняется — пришлите скрин кабинета и логи бэкенда разработчику.";
        const driversWithoutName = parseDiagnostics ? (parseDiagnostics as Diag).driversWithoutName : undefined;
        const noNameSuffix = driversWithoutName != null && driversWithoutName > 0
          ? ` Показаны водители без ФИО (${driversWithoutName} шт.).`
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
            ...(parseDiagnostics != null && typeof (parseDiagnostics as Diag).rawDriverProfilesLength === "number" && { rawCount: (parseDiagnostics as Diag).rawDriverProfilesLength }),
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
            data: { fleetParkId: null, yandexApiKey: null, yandexParkId: null, yandexClientId: null },
          });
          return reply.send({
            drivers: [],
            meta: {
              source: "fleet",
              count: 0,
              credsInvalid: true,
              hint: "Парк изменился или ключ недействителен. Подключите парк заново.",
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
      middle_name: null as string | null,
      balance: undefined,
      workStatus: undefined,
      car_id: null as string | null,
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

  /**
   * GET /api/manager/fleet-lists/:type
   * Справочники Fleet: countries, car-brands, car-models, colors. Для car-models — query brand=.
   */
  app.get<{ Params: { type: string }; Querystring: { brand?: string } }>("/fleet-lists/:type", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });
    const creds = await getManagerFleetCreds(managerId);
    if (!creds) return reply.status(400).send({ error: "Fleet not connected", message: "Подключите парк (API-ключ)." });
    const type = req.params.type as FleetListType;
    const allowed: FleetListType[] = ["countries", "car-brands", "car-models", "colors"];
    if (!allowed.includes(type)) return reply.status(400).send({ error: "Invalid type", message: "type: countries | car-brands | car-models | colors" });
    try {
      const list = await getFleetList(creds, type, type === "car-models" ? { brand: req.query.brand } : undefined);
      return reply.send({ items: list });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ step: "fleet_lists", type, error: msg.slice(0, 200) });
      return reply.status(502).send({ error: "Fleet list error", message: msg.slice(0, 300) });
    }
  });

  /**
   * GET /api/manager/driver/:driverId
   * Полный профиль водителя из парка (для карточки). Без даты рождения.
   */
  app.get<{ Params: { driverId: string } }>("/driver/:driverId", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });
    const creds = await getManagerFleetCreds(managerId);
    if (!creds) return reply.status(400).send({ error: "Fleet not connected", message: "Подключите парк." });
    const driverId = req.params.driverId?.trim();
    if (!driverId) return reply.status(400).send({ error: "driverId required" });
    try {
      const profile = await getDriverProfileById(creds, driverId);
      if (!profile) return reply.status(404).send({ error: "Driver not found", message: "Водитель не найден в парке." });
      return reply.send({ driver: profile });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ step: "driver_get", driverId, error: msg.slice(0, 200) });
      return reply.status(502).send({ error: "Fleet error", message: msg.slice(0, 300) });
    }
  });

  /**
   * GET /api/manager/driver/:driverId/balance
   * Баланс и заблокированный баланс водителя (Fleet ContractorProfiles blocked-balance).
   */
  app.get<{ Params: { driverId: string } }>("/driver/:driverId/balance", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });
    const creds = await getManagerFleetCreds(managerId);
    if (!creds) return reply.status(400).send({ error: "Fleet not connected", message: "Подключите парк." });
    const driverId = req.params.driverId?.trim();
    if (!driverId) return reply.status(400).send({ error: "driverId required" });
    try {
      const balance = await getContractorBlockedBalance(creds, driverId);
      if (!balance) return reply.status(404).send({ error: "Balance not found", message: "Баланс недоступен." });
      return reply.send(balance);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ step: "driver_balance", driverId, error: msg.slice(0, 200) });
      return reply.status(502).send({ error: "Fleet error", message: msg.slice(0, 300) });
    }
  });

  /**
   * GET /api/manager/driver-work-rules
   * Список условий работы в парке (Fleet DriverWorkRules).
   */
  app.get("/driver-work-rules", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });
    const creds = await getManagerFleetCreds(managerId);
    if (!creds) return reply.status(400).send({ error: "Fleet not connected", message: "Подключите парк." });
    try {
      const rules = await getDriverWorkRules(creds);
      return reply.send({ rules });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ step: "driver_work_rules", error: msg.slice(0, 200) });
      return reply.status(502).send({ error: "Fleet error", message: msg.slice(0, 300) });
    }
  });

  /**
   * POST /api/manager/driver/:driverId/update
   * Body: { driver_profile?: { ... }, car?: { ... } }. Обновление водителя и/или авто в Fleet.
   */
  app.post<{
    Params: { driverId: string };
    Body: { driver_profile?: Record<string, unknown>; car?: Record<string, unknown>; car_id?: string };
  }>("/driver/:driverId/update", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });
    const creds = await getManagerFleetCreds(managerId);
    if (!creds) return reply.status(400).send({ error: "Fleet not connected", message: "Подключите парк." });
    const driverId = req.params.driverId?.trim();
    if (!driverId) return reply.status(400).send({ error: "driverId required" });
    const body = (req.body as { driver_profile?: Record<string, unknown>; car?: Record<string, unknown>; car_id?: string }) ?? {};
    try {
      if (body.driver_profile && Object.keys(body.driver_profile).length > 0) {
        const dp = body.driver_profile as {
          first_name?: string;
          last_name?: string;
          middle_name?: string;
          phones?: string[];
          driver_experience?: number;
          driver_license?: { series_number?: string; country?: string; issue_date?: string; expiration_date?: string };
        };
        await updateDriverProfile(creds, driverId, {
          first_name: dp.first_name,
          last_name: dp.last_name,
          middle_name: dp.middle_name,
          phones: dp.phones,
          driver_experience: dp.driver_experience,
          driver_license: dp.driver_license,
        });
      }
      if (body.car && (body.car_id ?? (body.car as { car_id?: string }).car_id)) {
        const carId = (body.car_id ?? (body.car as { car_id?: string }).car_id) as string;
        const car = body.car as { brand?: string; model?: string; color?: string; year?: number; number?: string; registration_certificate_number?: string };
        await updateCar(creds, carId, {
          brand: car.brand,
          model: car.model,
          color: car.color,
          year: car.year,
          number: car.number,
          registration_certificate_number: car.registration_certificate_number,
        });
      }
      req.log.info({ step: "driver_update", managerId, driverId });
      return reply.send({ success: true, message: "Данные сохранены." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ step: "driver_update", driverId, error: msg.slice(0, 200) });
      const statusMatch = msg.match(/Fleet (?:driver-profiles|cars) update (\d+):/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 502;
      return reply.status(status > 0 && status < 600 ? status : 502).send({
        error: "Update failed",
        message: fleetStatusToRussian(status),
        details: msg.slice(0, 300),
      });
    }
  });
}
