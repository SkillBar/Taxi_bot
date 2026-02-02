import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";

async function authFromInitData(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) ?? "";
  if (!initData || !validateInitData(initData, config.botToken)) {
    return reply.status(401).send({ error: "Invalid or missing initData" });
  }
  const { user } = parseInitData(initData);
  if (!user?.id) return reply.status(401).send({ error: "User not in initData" });
  (req as any).telegramUserId = user.id;
}

// Example list; replace with API/DB when you have executor tariffs source
const EXECUTOR_TARIFFS: Record<string, { id: string; name: string }[]> = {
  driver: [
    { id: "comfort", name: "Комфорт" },
    { id: "economy", name: "Эконом" },
    { id: "business", name: "Бизнес" },
  ],
  courier: [
    { id: "standard", name: "Стандарт" },
    { id: "express", name: "Экспресс" },
  ],
};

export async function executorTariffsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { type?: "driver" | "courier" };
  }>("/", {
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const type = req.query.type ?? "driver";
    const list = EXECUTOR_TARIFFS[type] ?? EXECUTOR_TARIFFS.driver;
    return reply.send({ type, tariffs: list });
  });
}
