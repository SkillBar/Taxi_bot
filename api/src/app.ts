import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { agentRoutes } from "./routes/agent.js";
import { draftRoutes } from "./routes/draft.js";
import { executorTariffsRoutes } from "./routes/executor-tariffs.js";
import { managerRoutes } from "./routes/manager.js";
import { statsRoutes } from "./routes/stats.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    // Разрешаем любой origin (для dev и Mini App из Telegram). В проде можно задать WEBAPP_ORIGIN.
    origin: process.env.WEBAPP_ORIGIN ?? true,
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(agentRoutes, { prefix: "/api/agents" });
  await app.register(draftRoutes, { prefix: "/api/drafts" });
  await app.register(executorTariffsRoutes, { prefix: "/api/executor-tariffs" });
  await app.register(managerRoutes, { prefix: "/api/manager" });
  await app.register(statsRoutes, { prefix: "/api/stats" });

  return app;
}

// Single app instance: default export for Vercel (must be function or server).
const app = await buildApp();

// Listen only when running locally, NOT on Vercel (serverless).
// Equivalent to: if (require.main === module) { app.listen(...) }
if (!process.env.VERCEL) {
  const { config } = await import("./config.js");
  const host = config.host ?? "0.0.0.0";
  const port = Number(config.port) || 3001;
  app.listen({ host, port }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

export default app;
