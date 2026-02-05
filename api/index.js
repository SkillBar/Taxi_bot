/**
 * Vercel entry: export a function so the module has a valid default at load time.
 * Lazy-load dist/app.js on first request to avoid "Invalid export" from loading app.js directly.
 */
export default async function handler(req, res) {
  const { default: appHandler } = await import("./dist/app.js");
  return appHandler(req, res);
}
