/**
 * Vercel Serverless Entry Point.
 * Exports a handler function (not the app) so Vercel accepts the default export.
 * Ensures app.ready() before handling each request; waits for response to finish.
 */
import app from "./_dist/index.js";

export default async function handler(req, res) {
  await app.ready();
  return new Promise((resolve) => {
    const onEnd = () => resolve(undefined);
    res.once("finish", onEnd);
    res.once("close", onEnd);
    app.server.emit("request", req, res);
  });
}
