import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { config } from "./config.js";
import app from "./app.js";

// On Vercel entry is app.js (no listen); locally we start the server here.
if (!process.env.VERCEL) {
  const host = config.host ?? "0.0.0.0";
  const port = Number(config.port) || 3001;
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Default export so that index.js also works as Vercel entry point if selected.
export default app;
