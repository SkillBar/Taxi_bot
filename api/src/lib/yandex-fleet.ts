/**
 * Yandex Fleet API: driver-profiles/list.
 * https://fleet.yandex.ru/docs/api/ru/
 * Base URL: https://fleet-api.taxi.yandex.net
 */
import { config } from "../config.js";

const FLEET_API_BASE = "https://fleet-api.taxi.yandex.net";
const DRIVER_PROFILES_LIST = `${FLEET_API_BASE}/v1/parks/driver-profiles/list`;
const PARKS_LIST = `${FLEET_API_BASE}/v1/parks/list`;
const PARKS_INFO = `${FLEET_API_BASE}/v1/parks/info`;

const FLEET_FETCH_RETRIES = 3;
const FLEET_RETRY_DELAY_MS = 1500;

/** Повтор запроса при 429 или сетевой ошибке. */
async function fetchWithRetry(
  fn: () => Promise<Response>,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<Response> {
  const { retries = FLEET_FETCH_RETRIES, delayMs = FLEET_RETRY_DELAY_MS } = opts;
  let lastRes: Response | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fn();
      lastRes = res;
      if (res.status !== 429) return res;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  if (lastRes != null) return lastRes;
  throw lastErr ?? new Error("Fleet request failed");
}

/** Человекочитаемое сообщение по коду ответа Fleet API. */
export function fleetStatusToRussian(statusCode: number): string {
  switch (statusCode) {
    case 401:
    case 403:
      return "Неверный API-ключ или доступ запрещён. Проверьте ключ в кабинете fleet.yandex.ru.";
    case 404:
      return "Парк не найден. Проверьте ID парка.";
    case 429:
      return "Слишком много запросов к Fleet. Подождите минуту и попробуйте снова.";
    case 500:
    case 502:
    case 503:
      return "Ошибка на стороне Yandex. Попробуйте позже.";
    default:
      return `Ошибка Fleet API (HTTP ${statusCode}). Проверьте ключ и ID парка.`;
  }
}

export type YandexDriverProfile = {
  yandexId: string;
  name: string | null;
  phone: string;
  balance?: number;
  workStatus?: string;
};

/** Учётные данные менеджера (из БД) или глобальный config */
export type FleetCredentials = {
  apiKey: string;
  parkId: string;
  clientId: string;
};

/** Fleet API: X-Client-ID, X-API-Key, X-Park-Id (парк в заголовке часто обязателен). */
function headersFrom(creds: FleetCredentials): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Client-ID": creds.clientId,
    "X-API-Key": creds.apiKey,
    "X-Park-Id": creds.parkId,
  };
}

function headers(): Record<string, string> {
  const clientId = config.yandexClientId;
  const apiKey = config.yandexApiKey;
  const parkId = config.yandexParkId;
  if (!clientId || !apiKey || !parkId) throw new Error("YANDEX_CLIENT_ID, YANDEX_API_KEY and YANDEX_PARK_ID required");
  return headersFrom({ apiKey, parkId, clientId });
}

export function isConfigured(): boolean {
  return Boolean(config.yandexParkId && config.yandexClientId && config.yandexApiKey);
}

/**
 * Попытка получить ID парка по одному API-ключу.
 * Пробует /v1/parks/info (один парк), затем /v1/parks/list (массив парков).
 * Если оба недоступны или ключ без прав — возвращает null.
 */
export async function tryDiscoverParkId(apiKey: string): Promise<string | null> {
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Client-ID": "taxi",
  };

  // 1) /v1/parks/info — часто возвращает один парк по ключу
  try {
    const resInfo = await fetch(PARKS_INFO, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    console.log(`[tryDiscoverParkId] POST /v1/parks/info → HTTP ${resInfo.status}`);
    if (resInfo.ok) {
      const data = (await resInfo.json()) as { park?: { id?: string }; parks?: Array<{ id?: string }> };
      const id = data?.park?.id ?? data?.parks?.[0]?.id;
      if (typeof id === "string" && id.length > 0) {
        console.log(`[tryDiscoverParkId] parkId определён по /parks/info: ${id}`);
        return id;
      }
    } else {
      const text = await resInfo.text();
      console.log(`[tryDiscoverParkId] /parks/info body: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`[tryDiscoverParkId] /parks/info error:`, (e as Error).message);
  }

  // 2) /v1/parks/list — список парков
  try {
    const res = await fetch(PARKS_LIST, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    console.log(`[tryDiscoverParkId] POST /v1/parks/list → HTTP ${res.status}`);
    if (!res.ok) {
      const text = await res.text();
      console.log(`[tryDiscoverParkId] /parks/list body: ${text.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { parks?: Array<{ id?: string }> };
    const id = data?.parks?.[0]?.id;
    if (typeof id === "string" && id.length > 0) {
      console.log(`[tryDiscoverParkId] parkId определён по /parks/list: ${id}`);
      return id;
    }
  } catch (e) {
    console.log(`[tryDiscoverParkId] /parks/list error:`, (e as Error).message);
  }
  console.log(`[tryDiscoverParkId] не удалось определить parkId по ключу`);
  return null;
}

/**
 * Проверка API-ключа: тестовый запрос к Fleet (с retry при 429).
 * clientId — из кабинета (Настройки → API); если не передан, берётся taxi/park/{parkId}.
 */
export type ValidateFleetResult = { ok: true } | { ok: false; message: string; statusCode: number };

export async function validateFleetCredentials(apiKey: string, parkId: string, clientId?: string): Promise<ValidateFleetResult> {
  const resolvedClientId = (clientId && clientId.trim()) ? clientId.trim() : `taxi/park/${parkId}`;
  const body = {
    query: { park: { id: parkId } },
    fields: { driver_profile: ["id"], account: ["balance"] },
    limit: 1,
  };
  const res = await fetchWithRetry(() =>
    fetch(DRIVER_PROFILES_LIST, {
      method: "POST",
      headers: headersFrom({ apiKey, parkId, clientId: resolvedClientId }),
      body: JSON.stringify(body),
    })
  );
  if (res.ok) return { ok: true };
  const text = await res.text();
  return { ok: false, message: `Fleet API ${res.status}: ${text.slice(0, 300)}`, statusCode: res.status };
}

/**
 * Нормализация телефона в +7... для поиска в диспетчерской.
 */
export function normalizePhoneForYandex(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  return raw.startsWith("+") ? raw : "+" + raw;
}

/** Из поля phones в ответе Fleet API (массив строк или объектов с number). */
function parsePhoneFromPhones(phones: unknown): string | null {
  if (Array.isArray(phones) && phones.length > 0) {
    const first = phones[0];
    if (typeof first === "string") return first;
    if (first != null && typeof first === "object" && "number" in first) return String((first as { number?: string }).number ?? "");
  }
  return null;
}

/**
 * Поиск водителя в Яндексе по номеру телефона (query.text).
 * creds — учётные данные менеджера; если не переданы, используется глобальный config.
 */
export async function findDriverByPhone(phone: string, creds?: FleetCredentials | null): Promise<YandexDriverProfile | null> {
  const useCreds = creds != null ? creds : (isConfigured() ? { apiKey: config.yandexApiKey!, parkId: config.yandexParkId!, clientId: config.yandexClientId! } : null);
  if (!useCreds) return null;
  const parkId = useCreds.parkId;
  const normalized = normalizePhoneForYandex(phone);

  // limit/offset — на верхнем уровне тела (документация Fleet API)
  const body = {
    query: {
      park: { id: parkId },
      text: normalized,
    },
    fields: {
      driver_profile: ["id", "work_status", "first_name", "last_name", "phones"],
      account: ["balance", "currency"],
    },
    limit: 1,
  };

  const res = await fetch(DRIVER_PROFILES_LIST, {
    method: "POST",
    headers: headersFrom(useCreds),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Yandex Fleet API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    driver_profiles?: Array<{
      driver_profile?: { id?: string; work_status?: string; first_name?: string; last_name?: string; phones?: unknown };
      accounts?: Array<{ balance?: string }>;
    }>;
  };

  const list = data.driver_profiles || [];
  if (list.length === 0) return null;

  const d = list[0];
  const profile = d.driver_profile;
  const id = profile?.id || "";
  const firstName = profile?.first_name?.trim() || "";
  const lastName = profile?.last_name?.trim() || "";
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;
  const phoneVal = parsePhoneFromPhones(profile?.phones) || normalized;
  const balanceRaw = d.accounts?.[0]?.balance;
  const balance = balanceRaw != null ? parseFloat(String(balanceRaw)) : undefined;
  const workStatus = profile?.work_status;

  return { yandexId: id, name, phone: phoneVal, balance, workStatus };
}

/**
 * Получение статусов/балансов по списку driver_profile_id (батч до 50–100 ID).
 * creds — учётные данные менеджера; если не переданы, используется глобальный config.
 */
export async function getDriversStatus(
  driverIds: string[],
  creds?: FleetCredentials | null
): Promise<Map<string, Omit<YandexDriverProfile, "yandexId">>> {
  const result = new Map<string, Omit<YandexDriverProfile, "yandexId">>();
  const useCreds = creds != null ? creds : (isConfigured() ? { apiKey: config.yandexApiKey!, parkId: config.yandexParkId!, clientId: config.yandexClientId! } : null);
  if (!useCreds || driverIds.length === 0) return result;

  const parkId = useCreds.parkId;
  const body = {
    query: {
      park: {
        id: parkId,
        driver_profile: { id: driverIds },
      },
    },
    fields: {
      driver_profile: ["id", "work_status", "first_name", "last_name", "phones"],
      account: ["balance", "currency"],
    },
  };

  const res = await fetch(DRIVER_PROFILES_LIST, {
    method: "POST",
    headers: headersFrom(useCreds),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Yandex Fleet API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    driver_profiles?: Array<{
      driver_profile?: { id?: string; work_status?: string; first_name?: string; last_name?: string; phones?: unknown };
      accounts?: Array<{ balance?: string }>;
    }>;
  };

  for (const d of data.driver_profiles || []) {
    const profile = d.driver_profile;
    const id = profile?.id;
    if (!id) continue;
    const firstName = profile?.first_name?.trim() || "";
    const lastName = profile?.last_name?.trim() || "";
    const name = [firstName, lastName].filter(Boolean).join(" ") || null;
    const phone = parsePhoneFromPhones(profile?.phones) || "";
    const balanceRaw = d.accounts?.[0]?.balance;
    const balance = balanceRaw != null ? parseFloat(String(balanceRaw)) : undefined;
    const workStatus = profile?.work_status;
    result.set(id, { name, phone, balance, workStatus });
  }

  return result;
}
