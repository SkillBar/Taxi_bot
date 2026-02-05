import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
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

// Lazy singleton for Vercel (one app per function instance).
let appPromise: Promise<FastifyInstance> | null = null;
function getApp(): Promise<FastifyInstance> {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}

/**
 * Vercel expects default export to be a function (request handler), not a Promise.
 * This handler forwards Node req/res to the Fastify app.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const app = await getApp();
  await app.ready();
  app.server.emit("request", req, res);
}
