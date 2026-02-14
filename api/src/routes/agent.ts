import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";
import { requireInitData, INIT_DATA_MAX_AGE_SEC, type RequestWithTelegram } from "../lib/auth.js";
import {
  normalizePhone,
  checkExternalAgent,
  upsertAgentFromExternal,
} from "../services/agent-link.js";

export async function agentRoutes(app: FastifyInstance) {
  // Текущий пользователь из initData (имя + привязка к агенту)
  app.get("/me", async (req, reply) => {
    const initData = (req.headers["x-telegram-init-data"] as string) || "";
    const hasBotToken = Boolean(config.botToken && config.botToken.length > 0);
    app.log.info({
      step: "agents/me",
      initDataLength: initData.length,
      hasBotToken,
      result: !initData ? "initData_missing" : !hasBotToken ? "botToken_missing" : "checking_validation",
    });
    if (!initData || !validateInitData(initData, config.botToken, INIT_DATA_MAX_AGE_SEC)) {
      app.log.info({ step: "agents/me", result: "initData_invalid" });
      return reply.status(401).send({ error: "Invalid or missing initData" });
    }
    const { user } = parseInitData(initData);
    if (!user?.id) {
      app.log.info({ step: "agents/me", result: "user_missing" });
      return reply.status(401).send({ error: "User not in initData" });
    }
    let agent;
    try {
      agent = await prisma.agent.findUnique({
        where: { telegramUserId: String(user.id) },
      });
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      app.log.error({ step: "agents/me", error: msg, telegramUserId: user.id });
      return reply.status(500).send({ error: "Database error", details: msg });
    }
    const linked = Boolean(agent?.isActive);
    app.log.info({ step: "agents/me", telegramUserId: user.id, linked, agentId: agent?.id != null ? agent.id : null });
    return reply.send({
      telegramUserId: user.id,
      firstName: user.first_name != null ? user.first_name : null,
      lastName: user.last_name != null ? user.last_name : null,
      linked,
    });
  });

  // Check agent by phone (used by bot after contact share)
  app.get<{
    Querystring: { phone: string };
  }>("/check", async (req, reply) => {
    const phone = normalizePhone(req.query.phone != null ? req.query.phone : "");
    if (!phone || phone.length < 10) return reply.status(400).send({ error: "Phone required" });

    const external = await checkExternalAgent(phone);
    if (external) {
      if (!external.found || !external.isActive) {
        return reply.send({
          found: false,
          message: external.message || "Ваш номер не найден в системе. Обратитесь к администратору.",
        });
      }

      const agent = await upsertAgentFromExternal(phone, external.externalId || null, true);
      return reply.send({ found: true, agentId: agent.id });
    }

    const agent = await prisma.agent.findFirst({
      where: { phone, isActive: true },
    });
    if (!agent) {
      return reply.send({ found: false, message: "Ваш номер не найден в системе. Обратитесь к администратору." });
    }
    return reply.send({ found: true, agentId: agent.id });
  });

  // Link telegram user to agent (initData обязателен — берём telegramUserId из него)
  app.post<{
    Body: { phone: string };
  }>("/link", async (req, reply) => {
    const initData = (req.headers["x-telegram-init-data"] as string) || "";
    if (!initData || !validateInitData(initData, config.botToken, INIT_DATA_MAX_AGE_SEC)) {
      return reply.status(401).send({ error: "Invalid or missing initData" });
    }
    const { user } = parseInitData(initData);
    if (!user?.id) return reply.status(401).send({ error: "User not in initData" });
    const telegramUserId = String(user.id);
    const phone = normalizePhone((req.body as any)?.phone || "");
    if (!phone) return reply.status(400).send({ error: "phone required" });

    let agent = await prisma.agent.findFirst({
      where: { phone, isActive: true },
    });

    if (!agent) {
      const external = await checkExternalAgent(phone);
      if (!external?.found || !external.isActive) {
        return reply.status(404).send({ error: "Agent not found" });
      }
      agent = await upsertAgentFromExternal(phone, external.externalId || null, true);
    }

    await prisma.agent.update({
      where: { id: agent.id },
      data: { telegramUserId },
    });
    return reply.send({ agentId: agent.id });
  });

  // Get agent by telegram user id (for bot /start)
  app.get<{ Params: { telegramUserId: string } }>("/by-telegram/:telegramUserId", async (req, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { telegramUserId: req.params.telegramUserId },
    });
    if (!agent || !agent.isActive) return reply.status(404).send({ error: "Agent not found" });
    return reply.send({
      agentId: agent.id,
      yandexEmail: agent.yandexEmail || undefined,
    });
  });

  // Save Yandex email (только свой аккаунт — по initData)
  app.patch<{
    Params: { agentId: string };
    Body: { yandexEmail: string };
  }>("/:agentId/email", {
    preHandler: requireInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as RequestWithTelegram).telegramUserId);
    const { agentId } = req.params;
    const yandexEmail = (req.body as any)?.yandexEmail;
    if (typeof yandexEmail !== "string" || !/^[^\s@]+@(yandex\.ru|ya\.ru|yandex\.com|yandex\.by|yandex\.kz)$/i.test(yandexEmail))
      return reply.status(400).send({ error: "Valid yandex email required" });

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.telegramUserId !== telegramUserId)
      return reply.status(403).send({ error: "Forbidden", message: "Можно изменить только свой аккаунт." });

    await prisma.agent.update({
      where: { id: agentId },
      data: { yandexEmail },
    });
    return reply.send({ ok: true });
  });

  // List agent tariffs (conditions) — requires initData (from WebApp)
  app.get("/me/tariffs", {
    preHandler: requireInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as RequestWithTelegram).telegramUserId);
    const agent = await prisma.agent.findUnique({
      where: { telegramUserId },
      include: { agentTariffs: true },
    });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });
    return reply.send({
      agentId: agent.id,
      tariffs: agent.agentTariffs.map((t) => ({
        id: t.id,
        commissionPercent: t.commissionPercent,
        name: t.name,
      })),
    });
  });

  // Create new agent tariff (condition)
  app.post<{
    Body: { commissionPercent: number };
  }>("/me/tariffs", {
    preHandler: requireInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as RequestWithTelegram).telegramUserId);
    const { commissionPercent } = req.body || {};
    if (typeof commissionPercent !== "number" || commissionPercent < 0 || commissionPercent > 100)
      return reply.status(400).send({ error: "commissionPercent 0-100 required" });

    const agent = await prisma.agent.findUnique({ where: { telegramUserId } });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const tariff = await prisma.agentTariff.create({
      data: { agentId: agent.id, commissionPercent },
    });
    return reply.send({ id: tariff.id, commissionPercent: tariff.commissionPercent });
  });
}
