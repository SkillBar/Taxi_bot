import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";

async function authFromInitData(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData || !validateInitData(initData, config.botToken)) {
    return reply.status(401).send({ error: "Invalid or missing initData" });
  }
  const { user } = parseInitData(initData);
  if (!user?.id) return reply.status(401).send({ error: "User not in initData" });
  (req as FastifyRequest & { telegramUserId?: number }).telegramUserId = user.id;
}

export async function agentRoutes(app: FastifyInstance) {
  // Текущий пользователь из initData (имя + привязка к агенту)
  app.get("/me", async (req, reply) => {
    const initData = (req.headers["x-telegram-init-data"] as string) || "";
    if (!initData || !validateInitData(initData, config.botToken)) {
      app.log.info({ step: "agents/me", result: "initData_invalid" });
      return reply.status(401).send({ error: "Invalid or missing initData" });
    }
    const { user } = parseInitData(initData);
    if (!user?.id) {
      app.log.info({ step: "agents/me", result: "user_missing" });
      return reply.status(401).send({ error: "User not in initData" });
    }
    const agent = await prisma.agent.findUnique({
      where: { telegramUserId: String(user.id) },
    });
    const linked = Boolean(agent?.isActive);
    app.log.info({ step: "agents/me", telegramUserId: user.id, linked, agentId: agent?.id ?? null });
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
    const phone = normalizePhone(req.query.phone);
    if (!phone) return reply.status(400).send({ error: "Phone required" });

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

  // Link from bot: после requestContact в Mini App бот получает контакт и вызывает этот endpoint
  app.post<{
    Body: { phone: string; telegramUserId: string };
  }>("/link-from-bot", async (req, reply) => {
    const secret = (req.headers["x-api-secret"] as string) || "";
    if (!config.apiSecret || secret !== config.apiSecret) {
      app.log.warn({ step: "link-from-bot", result: "invalid_secret" });
      return reply.status(401).send({ error: "Invalid or missing X-Api-Secret" });
    }
    const body = req.body as { phone?: string; telegramUserId?: string };
    const phone = normalizePhone(body?.phone || "");
    const telegramUserId = body?.telegramUserId;
    if (!phone || !telegramUserId) {
      return reply.status(400).send({ error: "phone and telegramUserId required" });
    }

    let agent = await prisma.agent.findFirst({
      where: { phone, isActive: true },
    });
    if (!agent) {
      const external = await checkExternalAgent(phone);
      if (!external?.found || !external.isActive) {
        app.log.info({
          step: "link-from-bot",
          result: "agent_not_found",
          phoneSuffix: phone.slice(-4),
          telegramUserId,
          externalMessage: external?.message,
        });
        return reply.status(404).send({
          error: "Agent not found",
          message: external?.message || "Ваш номер не найден в системе. Обратитесь к администратору.",
        });
      }
      agent = await upsertAgentFromExternal(phone, external.externalId || null, true);
    }
    await prisma.agent.update({
      where: { id: agent.id },
      data: { telegramUserId: String(telegramUserId) },
    });
    app.log.info({
      step: "link-from-bot",
      result: "success",
      agentId: agent.id,
      telegramUserId,
      phoneSuffix: phone.slice(-4),
    });
    return reply.send({ agentId: agent.id });
  });

  // Link telegram user to agent (initData обязателен — берём telegramUserId из него)
  app.post<{
    Body: { phone: string };
  }>("/link", async (req, reply) => {
    const initData = (req.headers["x-telegram-init-data"] as string) || "";
    if (!initData || !validateInitData(initData, config.botToken)) {
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

  // Save Yandex email
  app.patch<{
    Params: { agentId: string };
    Body: { yandexEmail: string };
  }>("/:agentId/email", async (req, reply) => {
    const { agentId } = req.params;
    const yandexEmail = (req.body as any)?.yandexEmail;
    if (typeof yandexEmail !== "string" || !/^[^\s@]+@(yandex\.ru|ya\.ru|yandex\.com|yandex\.by|yandex\.kz)$/i.test(yandexEmail))
      return reply.status(400).send({ error: "Valid yandex email required" });

    await prisma.agent.update({
      where: { id: agentId },
      data: { yandexEmail },
    });
    return reply.send({ ok: true });
  });

  // List agent tariffs (conditions) — requires initData (from WebApp)
  app.get("/me/tariffs", {
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as any).telegramUserId);
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
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as any).telegramUserId);
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

type ExternalAgentCheck = {
  found: boolean;
  externalId?: string | null;
  isActive?: boolean;
  message?: string;
};

async function checkExternalAgent(phone: string): Promise<ExternalAgentCheck | null> {
  if (!config.agentCheckUrl) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.agentCheckApiKey) {
    headers["X-API-Key"] = config.agentCheckApiKey;
    headers["Authorization"] = `Bearer ${config.agentCheckApiKey}`;
  }

  const res = await fetch(config.agentCheckUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone }),
  });

  if (!res.ok) {
    return { found: false, message: "Ошибка проверки номера. Попробуйте позже." };
  }

  const data = (await res.json()) as any;
  const found = Boolean(data?.found || data?.isFound || data?.ok);
  const externalId = data?.externalId || data?.agentId || data?.id || null;
  const isActive = data?.isActive || data?.active || found;
  const message = data?.message;
  return { found, externalId, isActive, message };
}

async function upsertAgentFromExternal(phone: string, externalId: string | null, isActive: boolean) {
  if (externalId) {
    const existingByExternal = await prisma.agent.findUnique({ where: { externalId } });
    if (existingByExternal) {
      return prisma.agent.update({
        where: { id: existingByExternal.id },
        data: { phone, isActive },
      });
    }
  }

  const existingByPhone = await prisma.agent.findFirst({ where: { phone } });
  if (existingByPhone) {
    return prisma.agent.update({
      where: { id: existingByPhone.id },
      data: { externalId: externalId || existingByPhone.externalId, isActive },
    });
  }

  return prisma.agent.create({
    data: {
      phone,
      externalId: externalId || undefined,
      isActive,
    },
  });
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  return raw.startsWith("+") ? raw : "+" + digits;
}
