import type { FastifyInstance } from "fastify";
import { requireInitData } from "../lib/auth.js";

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
    preHandler: requireInitData,
  }, async (req, reply) => {
    const type = req.query.type || "driver";
    const list = EXECUTOR_TARIFFS[type] || EXECUTOR_TARIFFS.driver;
    return reply.send({ type, tariffs: list });
  });
}
