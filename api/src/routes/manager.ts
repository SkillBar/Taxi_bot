import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";
import {
  findDriverByPhone,
  getDriversStatus,
  normalizePhoneForYandex,
  validateFleetCredentials,
  tryDiscoverParkId,
  fleetStatusToRussian,
  type FleetCredentials,
} from "../lib/yandex-fleet.js";

async function requireManager(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData) {
    return reply.status(401).send({
      error: "Missing x-telegram-init-data",
      message: "Откройте приложение из Telegram — заголовок авторизации не передан.",
    });
  }
  if (!validateInitData(initData, config.botToken, 86400)) {
    return reply.status(401).send({
      error: "Invalid initData",
      message: "Неверная или устаревшая подпись. Перезапустите Mini App из Telegram.",
    });
  }
  const { user } = parseInitData(initData);
  if (!user?.id) {
    return reply.status(401).send({ error: "User not in initData", message: "В initData отсутствует user." });
  }
  (req as FastifyRequest & { telegramUserId?: number; telegramUser?: { first_name?: string; last_name?: string } }).telegramUserId = user.id;
  (req as FastifyRequest & { telegramUser?: { first_name?: string; last_name?: string } }).telegramUser = user;

  let manager = await prisma.manager.findUnique({
    where: { telegramId: String(user.id) },
  });
  if (!manager) {
    manager = await prisma.manager.create({
      data: { telegramId: String(user.id) },
    });
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
    if (!apiKey) return reply.status(400).send({ error: "apiKey required", message: "Введите API-ключ" });
    if (!parkId) {
      app.log.info({ step: "connect-fleet", message: "Пытаюсь определить parkId по ключу" });
      const discovered = await tryDiscoverParkId(apiKey);
      parkId = discovered != null ? discovered : "";
      if (!parkId) {
        app.log.warn({ step: "connect-fleet", message: "Не удалось определить parkId по ключу" });
        return reply.status(400).send({
          error: "parkId required",
          message: "Введите ID парка из кабинета Fleet (Настройки → Общая информация). Fleet API не возвращает список парков по ключу.",
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
    app.log.info({ step: "connect-fleet:success", managerId, parkId });
    return reply.send({ success: true, message: "Парк успешно подключён!" });
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
   * Список водителей менеджера: из БД + актуальные статусы/балансы из Yandex Fleet (один батч-запрос).
   */
  app.get("/drivers", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });

    const manager = await prisma.manager.findUnique({ where: { id: managerId } });
    const creds = manager ? managerFleetCreds(manager) : null;

    const links = await prisma.driverLink.findMany({
      where: { managerId },
      orderBy: { createdAt: "desc" },
    });

    if (links.length === 0) {
      return reply.send({ drivers: [] });
    }

    if (!creds) {
      return reply.send({ drivers: links.map((l) => ({ id: l.id, yandexDriverId: l.yandexDriverId, phone: l.driverPhone, name: l.cachedName, balance: undefined, workStatus: undefined })) });
    }

    const ids = links.map((l) => l.yandexDriverId);
    let statusMap;
    try {
      statusMap = await getDriversStatus(ids, creds);
    } catch (e) {
      app.log.error(e);
      return reply.status(502).send({ error: "Yandex Fleet API error", message: (e as Error).message });
    }

    const drivers = links.map((link) => {
      const live = statusMap.get(link.yandexDriverId);
      return {
        id: link.id,
        yandexDriverId: link.yandexDriverId,
        phone: link.driverPhone,
        name: link.cachedName || live?.name || null,
        balance: live?.balance,
        workStatus: live?.workStatus,
      };
    });

    return reply.send({ drivers });
  });
}
