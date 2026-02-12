import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";

async function authFromInitData(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData || !validateInitData(initData, config.botToken, 86400)) {
    return reply.status(401).send({ error: "Invalid or missing initData" });
  }
  const { user } = parseInitData(initData);
  if (!user?.id) return reply.status(401).send({ error: "User not in initData" });
  (req as any).telegramUserId = user.id;
}

async function authFromInitDataOrSecret(req: FastifyRequest, reply: FastifyReply) {
  const secret = req.headers["x-api-secret"];
  const agentId = (req.query as { agentId?: string }).agentId;
  if (config.apiSecret && secret === config.apiSecret && agentId) {
    (req as any).agentIdFromSecret = agentId;
    return;
  }
  return authFromInitData(req, reply);
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { period?: "day" | "week" | "month"; agentId?: string };
  }>("/", {
    preHandler: authFromInitDataOrSecret,
  }, async (req, reply) => {
    let agent: { id: string } | null;
    if ((req as any).agentIdFromSecret) {
      agent = await prisma.agent.findUnique({ where: { id: (req as any).agentIdFromSecret } });
    } else {
      const telegramUserId = String((req as any).telegramUserId);
      agent = await prisma.agent.findUnique({ where: { telegramUserId } });
    }
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const period = req.query.period || "month";
    const now = new Date();
    let from: Date;
    if (period === "day") {
      from = new Date(now);
      from.setDate(from.getDate() - 1);
    } else if (period === "week") {
      from = new Date(now);
      from.setDate(from.getDate() - 7);
    } else {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    }

    const [total, inPeriod, active] = await Promise.all([
      prisma.registrationDraft.count({ where: { agentId: agent.id, status: "done" } }),
      prisma.registrationDraft.count({
        where: { agentId: agent.id, status: "done", updatedAt: { gte: from } },
      }),
      prisma.registrationDraft.count({ where: { agentId: agent.id, status: "in_progress" } }),
    ]);

    return reply.send({
      totalRegistered: total,
      registeredInPeriod: inPeriod,
      period,
      activeDrafts: active,
      // payments/commission — integrate with your system when available
      payments: null,
    });
  });
}
