/**
 * Эндпоинты, вызываемые только ботом (авторизация по X-Api-Secret).
 * Префикс: /api/bot
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireBotSecret } from "../lib/auth.js";
import { linkAgentByTelegramId } from "../services/agent-link.js";
import { applyPhoneToManager, normalizePhoneForDb } from "./manager.js";

export async function botRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireBotSecret);

  /**
   * POST /api/bot/manager/set-phone
   * Сохранить номер менеджера и привязать к дефолтному парку (бот вызвал при message:contact).
   * После этого Mini App по GET /me увидит hasFleet и откроет кабинет в 1 клик.
   */
  app.post<{ Body: { telegramUserId?: string; phone?: string } }>("/manager/set-phone", async (req, reply) => {
    const body = req.body as { telegramUserId?: string; phone?: string };
    const telegramUserId = body?.telegramUserId?.trim();
    const phoneRaw = body?.phone?.trim();
    if (!telegramUserId || !phoneRaw) {
      return reply.status(400).send({ error: "telegramUserId and phone required" });
    }
    const phone = normalizePhoneForDb(phoneRaw);
    if (phone.length < 10) return reply.status(400).send({ error: "Invalid phone" });

    const result = await applyPhoneToManager(telegramUserId, phone, req.server);
    req.log.info({ step: "bot/manager/set-phone", telegramUserId, managerId: result.managerId, hasFleet: result.hasFleet, notInBase: result.notInBase });
    if (result.notInBase) {
      return reply.send({ ok: true, hasFleet: false, notInBase: true });
    }
    return reply.send({ ok: true, hasFleet: result.hasFleet });
  });

  /**
   * POST /api/bot/agents/link
   * Привязать Telegram user к агенту по номеру (после requestContact в боте).
   */
  app.post<{ Body: { phone?: string; telegramUserId?: string } }>("/agents/link", async (req, reply) => {
    const body = req.body as { phone?: string; telegramUserId?: string };
    const phone = body?.phone != null ? body.phone : "";
    const telegramUserId = body?.telegramUserId?.trim();
    if (!telegramUserId) {
      return reply.status(400).send({ error: "phone and telegramUserId required" });
    }

    const result = await linkAgentByTelegramId(phone, telegramUserId);
    if (!result.ok) {
      req.log.info({
        step: "bot/agents/link",
        result: "agent_not_found",
        phoneSuffix: phone.slice(-4),
        telegramUserId,
      });
      return reply.status(result.status).send({ error: "Agent not found", message: result.message });
    }
    req.log.info({ step: "bot/agents/link", result: "success", agentId: result.agentId, telegramUserId });
    return reply.send({ agentId: result.agentId });
  });
}
