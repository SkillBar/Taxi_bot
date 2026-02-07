#!/usr/bin/env node
/**
 * Проверка API-ключа Yandex Fleet без сервера и Telegram.
 * Запуск: node scripts/test-fleet-key.mjs ВАШ_API_КЛЮЧ
 * Показывает ответы /parks/info, /parks/list и при успехе — /driver-profiles/list.
 */

const apiKey = process.argv[2]?.trim();
if (!apiKey) {
  console.error("Использование: node scripts/test-fleet-key.mjs ВАШ_API_КЛЮЧ");
  process.exit(1);
}

const BASE = "https://fleet-api.taxi.yandex.net";

async function request(path, body = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Client-ID": "taxi",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, text, json };
}

async function main() {
  console.log("Проверка ключа (первые 8 символов):", apiKey.slice(0, 8) + "...\n");

  // 1) parks/info
  console.log("1) POST /v1/parks/info");
  const info = await request("/v1/parks/info", {});
  console.log("   HTTP", info.status);
  if (info.json) console.log("   Тело:", JSON.stringify(info.json).slice(0, 300));
  else console.log("   Тело:", info.text.slice(0, 300));
  const parkIdFromInfo = info.json?.park?.id ?? info.json?.parks?.[0]?.id;
  if (parkIdFromInfo) console.log("   → parkId:", parkIdFromInfo);
  console.log("");

  // 2) parks/list
  console.log("2) POST /v1/parks/list");
  const list = await request("/v1/parks/list", {});
  console.log("   HTTP", list.status);
  if (list.json) console.log("   Тело:", JSON.stringify(list.json).slice(0, 300));
  else console.log("   Тело:", list.text.slice(0, 300));
  const parkIdFromList = list.json?.parks?.[0]?.id;
  if (parkIdFromList) console.log("   → parkId:", parkIdFromList);
  console.log("");

  const parkId = parkIdFromInfo || parkIdFromList;
  if (!parkId) {
    console.log("Итог: parkId по ключу не определён. Проверьте ключ и права в кабинете Fleet.");
    process.exit(1);
  }

  // 3) driver-profiles/list (проверка доступа к водителям)
  console.log("3) POST /v1/parks/driver-profiles/list (parkId:", parkId + ")");
  const drivers = await request("/v1/parks/driver-profiles/list", {
    query: { park: { id: parkId } },
    limit: 1,
  }, {
    "X-Park-Id": parkId,
    "X-Client-ID": `taxi/park/${parkId}`,
  });
  console.log("   HTTP", drivers.status);
  if (drivers.json) console.log("   Тело:", JSON.stringify(drivers.json).slice(0, 400));
  else console.log("   Тело:", drivers.text.slice(0, 400));
  console.log("");

  if (drivers.status === 200) {
    console.log("Итог: ключ и парк рабочие, список водителей доступен.");
  } else {
    console.log("Итог: парк определился, но запрос водителей вернул", drivers.status, "— проверьте права ключа (Driver Profiles).");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
