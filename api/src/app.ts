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
    origin: process.env.WEBAPP_ORIGIN || true,
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
// При EADDRINUSE пробуем следующие порты (3002, 3003, … до 3010).
if (!process.env.VERCEL) {
  const { config } = await import("./config.js");
  const host = config.host || "0.0.0.0";
  const basePort = config.port;
  const maxTries = 10;

  async function tryListen(tryPort: number): Promise<void> {
    if (tryPort > basePort + maxTries - 1) {
      app.log.error(
        `Ports ${basePort}–${basePort + maxTries - 1} are in use. Free one with: lsof -ti :${basePort} | xargs kill`
      );
      process.exit(1);
    }
    try {
      await app.listen({ host, port: tryPort });
      if (tryPort !== basePort) {
        app.log.info(`Port ${basePort} was busy; listening on http://${host}:${tryPort}`);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EADDRINUSE") {
        app.log.warn(`Port ${tryPort} in use, trying ${tryPort + 1}…`);
        return tryListen(tryPort + 1);
      }
      app.log.error(err);
      process.exit(1);
    }
  }

  tryListen(basePort);
}

export default app;
