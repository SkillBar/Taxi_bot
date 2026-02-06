import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";
import {
  findDriverByPhone,
  getDriversStatus,
  normalizePhoneForYandex,
  isConfigured as isYandexFleetConfigured,
} from "../lib/yandex-fleet.js";

async function requireManager(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData) {
    return reply.status(401).send({
      error: "Missing x-telegram-init-data",
      message: "Откройте приложение из Telegram — заголовок авторизации не передан.",
    });
  }
  if (!validateInitData(initData, config.botToken)) {
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

export async function managerRoutes(app: FastifyInstance) {
  if (!isYandexFleetConfigured()) {
    app.log.warn("Yandex Fleet API not configured (YANDEX_PARK_ID, YANDEX_CLIENT_ID, YANDEX_API_KEY); /api/manager/* disabled");
    return;
  }

  app.addHook("preHandler", requireManager);

  /**
   * GET /api/manager/me
   * Текущий пользователь из initData (имя для приветствия).
   */
  app.get("/me", async (req, reply) => {
    const user = (req as FastifyRequest & { telegramUser?: { first_name?: string; last_name?: string } }).telegramUser;
    const telegramUserId = (req as FastifyRequest & { telegramUserId?: number }).telegramUserId;
    return reply.send({
      telegramUserId,
      firstName: user?.first_name != null ? user.first_name : null,
      lastName: user?.last_name != null ? user.last_name : null,
    });
  });

  /**
   * POST /api/manager/link-driver
   * Body: { phone: string }
   * Ищет водителя в Яндексе по телефону, создаёт DriverLink для текущего менеджера.
   */
  app.post<{ Body: { phone?: string } }>("/link-driver", async (req, reply) => {
    const managerId = (req as FastifyRequest & { managerId?: string }).managerId;
    if (!managerId) return reply.status(401).send({ error: "Manager not found" });

    const phone = (req.body as { phone?: string })?.phone;
    if (!phone || typeof phone !== "string") return reply.status(400).send({ error: "phone required" });

    const normalized = normalizePhoneForYandex(phone);
    let driver;
    try {
      driver = await findDriverByPhone(normalized);
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

    const links = await prisma.driverLink.findMany({
      where: { managerId },
      orderBy: { createdAt: "desc" },
    });

    if (links.length === 0) {
      return reply.send({ drivers: [] });
    }

    const ids = links.map((l) => l.yandexDriverId);
    let statusMap;
    try {
      statusMap = await getDriversStatus(ids);
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
