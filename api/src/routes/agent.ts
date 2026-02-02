import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";

async function authFromInitData(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) ?? "";
  if (!initData || !validateInitData(initData, config.botToken)) {
    return reply.status(401).send({ error: "Invalid or missing initData" });
  }
  const { user } = parseInitData(initData);
  if (!user?.id) return reply.status(401).send({ error: "User not in initData" });
  (req as FastifyRequest & { telegramUserId?: number }).telegramUserId = user.id;
}

export async function agentRoutes(app: FastifyInstance) {
  // Check agent by phone (used by bot after contact share)
  app.get<{
    Querystring: { phone: string };
  }>("/check", async (req, reply) => {
    const phone = normalizePhone(req.query.phone);
    if (!phone) return reply.status(400).send({ error: "Phone required" });

    const agent = await prisma.agent.findFirst({
      where: { phone, isActive: true },
    });
    if (!agent)
      return reply.send({ found: false, message: "Ваш номер не найден в системе. Обратитесь к администратору." });
    return reply.send({ found: true, agentId: agent.id });
  });

  // Link telegram user to agent (call after contact check so agent gets telegramUserId)
  app.post<{
    Body: { phone: string; telegramUserId: string };
  }>("/link", async (req, reply) => {
    const phone = normalizePhone((req.body as any)?.phone ?? "");
    const telegramUserId = (req.body as any)?.telegramUserId;
    if (!phone || !telegramUserId) return reply.status(400).send({ error: "phone and telegramUserId required" });

    const agent = await prisma.agent.findFirst({
      where: { phone, isActive: true },
    });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

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
      yandexEmail: agent.yandexEmail ?? undefined,
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
    const { commissionPercent } = req.body ?? {};
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

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  return raw.startsWith("+") ? raw : "+" + digits;
}
