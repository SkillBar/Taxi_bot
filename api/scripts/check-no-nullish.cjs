/**
 * Fails build if ?? (nullish coalescing) is found in api/src.
 * Vercel's @vercel/nft parser can choke on ?? (BinaryExpression).
 */
const fs = require("fs");
const path = require("path");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (/\.(ts|js)$/.test(e.name)) {
      const content = fs.readFileSync(full, "utf8");
      if (content.includes("??")) {
        console.error(`[check-no-nullish] Found ?? in ${full}`);
        process.exit(1);
      }
    }
  }
}

walk(path.join(__dirname, "..", "src"));
console.log("[check-no-nullish] No ?? in api/src");
