import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { agentRoutes } from "./routes/agent.js";
import { draftRoutes } from "./routes/draft.js";
import { executorTariffsRoutes } from "./routes/executor-tariffs.js";
import { statsRoutes } from "./routes/stats.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true, // in prod restrict to WEBAPP_ORIGIN
});

// Health
app.get("/health", async () => ({ ok: true }));

await app.register(agentRoutes, { prefix: "/api/agents" });
await app.register(draftRoutes, { prefix: "/api/drafts" });
await app.register(executorTariffsRoutes, { prefix: "/api/executor-tariffs" });
await app.register(statsRoutes, { prefix: "/api/stats" });

const host = config.host ?? "0.0.0.0";
const port = Number(config.port) || 3001;

try {
  await app.listen({ host, port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
