import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireInitData } from "../lib/auth.js";
import type { RequestWithTelegram } from "../lib/auth.js";

interface RequestWithOptionalAgentId extends RequestWithTelegram {
  agentIdFromSecret?: string;
}

async function requireInitDataOrBotSecret(
  req: FastifyRequest,
  reply: Parameters<typeof requireInitData>[1]
): Promise<void> {
  const secret = (req.headers["x-api-secret"] as string) || "";
  const agentId = (req.query as { agentId?: string }).agentId;
  if (config.apiSecret && secret === config.apiSecret && agentId) {
    (req as RequestWithOptionalAgentId).agentIdFromSecret = agentId;
    return;
  }
  await requireInitData(req, reply);
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { period?: "day" | "week" | "month"; agentId?: string };
  }>("/", {
    preHandler: requireInitDataOrBotSecret,
  }, async (req, reply) => {
    let agent: { id: string } | null;
    const reqAuth = req as RequestWithOptionalAgentId;
    if (reqAuth.agentIdFromSecret) {
      agent = await prisma.agent.findUnique({ where: { id: reqAuth.agentIdFromSecret } });
    } else {
      const telegramUserId = String(reqAuth.telegramUserId);
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
