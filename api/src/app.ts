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
import { statsRoutes } from "./routes/stats.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true, // in prod restrict to WEBAPP_ORIGIN
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(agentRoutes, { prefix: "/api/agents" });
  await app.register(draftRoutes, { prefix: "/api/drafts" });
  await app.register(executorTariffsRoutes, { prefix: "/api/executor-tariffs" });
  await app.register(statsRoutes, { prefix: "/api/stats" });

  return app;
}
