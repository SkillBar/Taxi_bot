/**
 * Postinstall: replace ?? with || in Fastify 4.x node_modules
 * so @vercel/nft (Node File Trace) doesn't choke on BinaryExpression.
 * Run after npm install / npm ci. Safe to run multiple times.
 */
const fs = require("fs");
const path = require("path");

const apiRoot = path.join(__dirname, "..");
const fastifyRoot = path.join(apiRoot, "node_modules", "fastify");
const files = [
  path.join(fastifyRoot, "lib", "server.js"),
  path.join(fastifyRoot, "lib", "route.js"),
  path.join(fastifyRoot, "lib", "error-handler.js"),
];

let patched = 0;
for (const file of files) {
  try {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, "utf8");
    const next = content.replace(/\s\?\?\s/g, " || ");
    if (next !== content) {
      fs.writeFileSync(file, next, "utf8");
      patched++;
    }
  } catch (e) {
    console.warn("[patch-fastify-nullish] skip", file, e.message);
  }
}
if (patched > 0) {
  console.log("[patch-fastify-nullish] patched", patched, "file(s)");
}
