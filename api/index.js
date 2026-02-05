/**
 * Vercel Serverless Entry Point.
 * Exports a handler function (not the app) so Vercel accepts the default export.
 * Ensures app.ready() before handling each request.
 */
import app from "./_dist/index.js";

export default async function handler(req, res) {
  await app.ready();
  app.server.emit("request", req, res);
}
