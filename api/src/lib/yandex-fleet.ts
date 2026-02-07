/**
 * Yandex Fleet API: driver-profiles/list.
 * https://fleet.yandex.ru/docs/api/ru/
 * Base URL: https://fleet-api.taxi.yandex.net
 */
import { config } from "../config.js";

const FLEET_API_BASE = "https://fleet-api.taxi.yandex.net";
const DRIVER_PROFILES_LIST = `${FLEET_API_BASE}/v1/parks/driver-profiles/list`;

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
 * Проверка API-ключа: тестовый запрос к Fleet.
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
  const res = await fetch(DRIVER_PROFILES_LIST, {
    method: "POST",
    headers: headersFrom({ apiKey, parkId, clientId: resolvedClientId }),
    body: JSON.stringify(body),
  });
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
