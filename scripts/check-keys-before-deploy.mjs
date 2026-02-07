#!/usr/bin/env node
/**
 * Проверка ключей и переменных перед деплоем.
 * Не выводит значения секретов, только наличие и формат.
 * Запуск: node scripts/check-keys-before-deploy.mjs
 * Читает .env в корне репозитория (если есть).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(process.cwd());
const envPath = resolve(root, ".env");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const env = loadEnv(envPath);

function has(key) {
  const v = env[key];
  return v != null && String(v).trim().length > 0;
}

function ok(key, note = "") {
  const v = has(key);
  console.log(v ? `  ✅ ${key}` : `  ❌ ${key} (обязательно)${note ? " " + note : ""}`);
  return v;
}

function warn(key, note) {
  const v = has(key);
  if (!v) console.log(`  ⚠️  ${key} — не задан${note ? ": " + note : ""}`);
  return v;
}

function urlOk(key, requireHttps = false) {
  const v = env[key];
  const set = v != null && String(v).trim().length > 0;
  if (!set) {
    console.log(`  ❌ ${key} (обязательно)`);
    return false;
  }
  const url = String(v).trim();
  const noTrailing = url.replace(/\/+$/, "");
  const isHttps = noTrailing.startsWith("https://");
  const isHttp = noTrailing.startsWith("http://");
  if (requireHttps && !isHttps) {
    console.log(`  ⚠️  ${key} — для прода нужен HTTPS (сейчас: ${url.slice(0, 30)}...)`);
    return false;
  }
  if (!isHttp && !isHttps && !url.startsWith("postgresql")) {
    console.log(`  ⚠️  ${key} — похоже не URL (значение скрыто)`);
  } else {
    console.log(`  ✅ ${key}`);
  }
  return true;
}

console.log("\n=== 1. API (Vercel / backend) ===\n");
let apiOk = true;
apiOk = ok("BOT_TOKEN", "— тот же токен, что у бота в BotFather") && apiOk;
apiOk = ok("DATABASE_URL") && apiOk;
urlOk("WEBAPP_URL"); // опционально для API, но нужно для CORS/логов
warn("API_SECRET", "нужен для link-from-bot с бота");
warn("WEBAPP_ORIGIN", "CORS: если пусто — разрешены все origin");

console.log("\n=== 2. Bot (Railway / где крутится бот) ===\n");
let botOk = true;
botOk = ok("BOT_TOKEN") && botOk;
botOk = urlOk("API_URL") && botOk;
botOk = urlOk("WEBAPP_URL") && botOk;
warn("API_SECRET", "должен совпадать с API");

console.log("\n=== 3. Webapp build (Vercel) — VITE_* задаются при сборке ===\n");
const viteUrl = env.VITE_API_URL;
const viteSet = viteUrl != null && String(viteUrl).trim().length > 0;
if (!viteSet) {
  console.log("  ❌ VITE_API_URL — в настройках проекта Vercel (Webapp) задать Environment Variable при build!");
  console.log("     Например: VITE_API_URL=https://your-api.vercel.app");
} else {
  const u = String(viteUrl).trim();
  if (u.startsWith("http://localhost")) {
    console.log("  ⚠️  VITE_API_URL — сейчас localhost. Для прода в Vercel задать URL продового API!");
  } else {
    console.log("  ✅ VITE_API_URL");
  }
}

console.log("\n=== 4. Связка (проверь вручную) ===\n");
console.log("  • В BotFather в настройках бота URL Mini App должен совпадать с WEBAPP_URL (тот же домен, что деплой webapp).");
console.log("  • BOT_TOKEN на API и у бота — один и тот же токен.");
console.log("  • VITE_API_URL при сборке webapp — точный URL твоего API (без слэша в конце).");
console.log("");

if (!apiOk || !botOk || !viteSet) {
  process.exit(1);
}
