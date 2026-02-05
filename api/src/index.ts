import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { config } from "./config.js";
import { buildApp } from "./app.js";
import handler from "./app.js";

// Local dev only. On Vercel the entry is index.js or app.js (handler function).
if (!process.env.VERCEL) {
  const app = await buildApp();
  const host = config.host ?? "0.0.0.0";
  const port = Number(config.port) || 3001;
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// So Vercel gets a function when it loads index.js (it may prefer index over app).
export default handler;
