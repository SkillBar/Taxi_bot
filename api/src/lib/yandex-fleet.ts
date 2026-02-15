/**
 * Yandex Fleet API: driver-profiles/list.
 * https://fleet.yandex.ru/docs/api/ru/
 * Base URL: https://fleet-api.taxi.yandex.net
 */
import { config } from "../config.js";

const FLEET_API_BASE = "https://fleet-api.taxi.yandex.net";
const DRIVER_PROFILES_LIST = `${FLEET_API_BASE}/v1/parks/driver-profiles/list`;
const DRIVER_PROFILE_CREATE = `${FLEET_API_BASE}/v2/parks/contractors/driver-profile`;
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
  throw lastErr != null ? lastErr : new Error("Fleet request failed");
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
    if (resInfo.ok) {
      const data = (await resInfo.json()) as { park?: { id?: string }; parks?: Array<{ id?: string }> };
      const id = data?.park?.id != null ? data.park!.id : data?.parks?.[0]?.id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    /* ignore */
  }

  // 2) /v1/parks/list — список парков
  try {
    const res = await fetch(PARKS_LIST, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { parks?: Array<{ id?: string }> };
    const id = data?.parks?.[0]?.id;
    if (typeof id === "string" && id.length > 0) return id;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Проверка API-ключа: тестовый запрос к Fleet (с retry при 429).
 * clientId — из кабинета (Настройки → API); если не передан, берётся taxi/park/{parkId}.
 */
export type ValidateFleetResult =
  | { ok: true }
  | { ok: false; message: string; statusCode: number; rawBody?: string; fleetCode?: string; fleetMessage?: string };

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
  let fleetCode: string | undefined;
  let fleetMessage: string | undefined;
  try {
    const json = JSON.parse(text) as { code?: string; message?: string };
    if (json?.code) fleetCode = String(json.code);
    if (json?.message) fleetMessage = String(json.message);
  } catch {
    /* не JSON */
  }
  return {
    ok: false,
    message: `Fleet API ${res.status}: ${text.slice(0, 300)}`,
    statusCode: res.status,
    rawBody: text.slice(0, 500),
    fleetCode,
    fleetMessage,
  };
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

/** Из поля phones в ответе Fleet API: строка, массив строк или массив объектов с number/phone. */
function parsePhoneFromPhones(phones: unknown): string | null {
  if (phones == null) return null;
  if (typeof phones === "string") return phones.trim() || null;
  if (!Array.isArray(phones) || phones.length === 0) return null;
  const first = phones[0];
  if (typeof first === "string") return first;
  if (first != null && typeof first === "object") {
    const obj = first as Record<string, unknown>;
    if ("number" in obj && obj.number != null) return String(obj.number);
    if ("phone" in obj && obj.phone != null) return String(obj.phone);
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

type DriverProfileItem = {
  driver_profile?: { id?: string; work_status?: string; first_name?: string; last_name?: string; phones?: unknown };
  accounts?: Array<{ balance?: string }>;
};

/** Маскирует телефоны и имена в срезе JSON для логов (privacy). Обрезает до maxLen символов. */
function maskSensitiveInJsonSample(jsonStr: string, maxLen: number): string {
  let s = jsonStr.slice(0, maxLen * 2);
  s = s.replace(/"first_name"\s*:\s*"[^"]*"/g, '"first_name":"***"');
  s = s.replace(/"last_name"\s*:\s*"[^"]*"/g, '"last_name":"***"');
  s = s.replace(/"number"\s*:\s*"[^"]*"/g, '"number":"***"');
  s = s.replace(/"phone"\s*:\s*"[^"]*"/g, '"phone":"***"');
  s = s.replace(/"phones"\s*:\s*\[[^\]]*\]/g, '"phones":["***"]');
  s = s.replace(/"[+]?\d{10,15}"/g, '"***"');
  s = s.replace(/\+?\d{10,15}/g, "***");
  return s.slice(0, maxLen);
}

/** Сдвигаем payload на уровень data, если ответ обёрнут в { data: ... }. */
function unwrapData(response: unknown): unknown {
  if (response != null && typeof response === "object") {
    const r = response as Record<string, unknown>;
    if (r.data != null && typeof r.data === "object") return r.data;
  }
  return response;
}

/** Достаём массив driver_profiles из ответа Fleet: сначала unwrap data, затем driver_profiles / parks. */
function parseDriverProfilesList(data: unknown): DriverProfileItem[] {
  const payload = unwrapData(data);
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) return payload as DriverProfileItem[];
  const o = payload as Record<string, unknown>;

  if (Array.isArray(o.driver_profiles)) return o.driver_profiles as DriverProfileItem[];

  if (Array.isArray(o.parks)) {
    const out: DriverProfileItem[] = [];
    for (const park of o.parks as Array<{ driver_profiles?: DriverProfileItem[] }>) {
      if (Array.isArray(park?.driver_profiles)) out.push(...park.driver_profiles);
    }
    return out;
  }
  if (o.parks != null && typeof o.parks === "object" && !Array.isArray(o.parks)) {
    const out: DriverProfileItem[] = [];
    for (const park of Object.values(o.parks as Record<string, { driver_profiles?: DriverProfileItem[] }>)) {
      if (park && Array.isArray(park.driver_profiles)) out.push(...park.driver_profiles);
    }
    return out;
  }
  return [];
}

export type ListParkDriversDiagnostics = {
  rawDriverProfilesLength: number;
  parsedDriversCount: number;
  firstItemSample?: string;
  /** Сколько водителей показаны с заглушкой «Водитель #…» из‑за отсутствия ФИО. */
  driversWithoutName?: number;
  /** HTTP-статус ответа Fleet (200, 401, 429 и т.д.). */
  fleetStatus?: number;
  /** Сколько записей отброшено при парсинге (raw - parsed). */
  skippedCount?: number;
  /** Сколько записей отброшено из‑за отсутствия id. */
  skippedNoId?: number;
};

/**
 * Список всех водителей парка из Fleet API (driver-profiles/list по park.id).
 * Поддерживаются форматы: { driver_profiles: [] }, { data: { driver_profiles: [] } }, { data: [] }, parks[]/parks{}.
 * onEmptyResponseKeys — ключи ответа при пустом rawList или firstItemKeys при отсеве всех; onParseDiagnostics — счётчики и firstItemSample при отсеве.
 */
export async function listParkDrivers(
  creds: FleetCredentials,
  opts: {
    limit?: number;
    offset?: number;
    onEmptyResponseKeys?: (keys: string[]) => void;
    onParseDiagnostics?: (d: ListParkDriversDiagnostics) => void;
    onRequestParams?: (p: { fields: Record<string, string[]>; queryParkId: string; limit: number; offset: number }) => void;
  } = {}
): Promise<YandexDriverProfile[]> {
  const { limit = 500, offset = 0, onEmptyResponseKeys, onParseDiagnostics, onRequestParams } = opts;
  const body = {
    query: { park: { id: creds.parkId } },
    fields: {
      driver_profile: ["id", "work_status", "first_name", "last_name", "phones"],
      account: ["balance", "currency"],
    },
    limit,
    offset,
  };
  onRequestParams?.({ fields: body.fields, queryParkId: creds.parkId, limit, offset });

  const res = await fetchWithRetry(() =>
    fetch(DRIVER_PROFILES_LIST, {
      method: "POST",
      headers: headersFrom(creds),
      body: JSON.stringify(body),
    })
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Yandex Fleet API error ${res.status}: ${err.slice(0, 500)}`);
  }

  const data = (await res.json()) as unknown;
  const topLevelKeys = data != null && typeof data === "object" ? Object.keys(data as Record<string, unknown>) : [];
  const hasDataWrapper = topLevelKeys.includes("data");
  const rawList = parseDriverProfilesList(data);
  if (rawList.length === 0 && onEmptyResponseKeys) {
    onEmptyResponseKeys(hasDataWrapper ? ["fleetResponseWrappedInData:true", ...topLevelKeys] : topLevelKeys);
  }

  const out: YandexDriverProfile[] = [];
  let driversWithoutName = 0;
  let skippedNoId = 0;
  for (const d of rawList) {
    const raw = d as Record<string, unknown>;
    const profile = (d.driver_profile ?? raw) as Record<string, unknown> | undefined;
    const nestedProfile = profile?.profile != null && typeof profile.profile === "object" ? (profile.profile as Record<string, unknown>) : undefined;
    const id =
      profile?.id != null
        ? String(profile.id)
        : raw.id != null
          ? String(raw.id)
          : nestedProfile?.id != null
            ? String(nestedProfile.id)
            : raw.driver_profile_id != null
              ? String(raw.driver_profile_id)
              : profile?.driver_profile_id != null
                ? String(profile.driver_profile_id)
                : undefined;
    if (!id) {
      skippedNoId += 1;
      continue;
    }
    const firstName = (profile?.first_name != null ? String(profile.first_name) : raw.first_name != null ? String(raw.first_name) : "").trim();
    const lastName = (profile?.last_name != null ? String(profile.last_name) : raw.last_name != null ? String(raw.last_name) : "").trim();
    let name = [firstName, lastName].filter(Boolean).join(" ") || null;
    if (!name && id) {
      name = "Водитель #" + id.slice(-6);
      driversWithoutName += 1;
    }
    const phones = profile?.phones ?? raw.phones;
    const phone = parsePhoneFromPhones(phones) || "";
    const accountsList = Array.isArray(d.accounts) ? d.accounts : Array.isArray((raw as { account?: unknown }).account) ? (raw as { account: Array<{ balance?: unknown }> }).account : [];
    const balanceRaw = accountsList[0]?.balance ?? (raw as { balance?: unknown }).balance;
    const balance = balanceRaw != null ? parseFloat(String(balanceRaw)) : undefined;
    const workStatus = (profile?.work_status != null ? String(profile.work_status) : raw.work_status != null ? String(raw.work_status) : undefined) as string | undefined;
    out.push({ yandexId: id, name, phone, balance, workStatus });
  }

  if (onParseDiagnostics) {
    const skippedCount = rawList.length - out.length;
    const diagnostics: ListParkDriversDiagnostics = {
      rawDriverProfilesLength: rawList.length,
      parsedDriversCount: out.length,
      fleetStatus: res.status,
      ...(driversWithoutName > 0 && { driversWithoutName }),
      ...(skippedCount > 0 && { skippedCount, ...(skippedNoId > 0 && { skippedNoId }) }),
    };
    if (rawList.length > 0 && out.length === 0) {
      diagnostics.firstItemSample = maskSensitiveInJsonSample(JSON.stringify(rawList[0], null, 2), 800);
      if (onEmptyResponseKeys) {
        const first = rawList[0] as Record<string, unknown>;
        onEmptyResponseKeys(["firstItemKeys:" + Object.keys(first).join(",")]);
      }
    }
    onParseDiagnostics(diagnostics);
  } else if (rawList.length > 0 && out.length === 0 && onEmptyResponseKeys) {
    const first = rawList[0] as Record<string, unknown>;
    onEmptyResponseKeys(["firstItemKeys:" + Object.keys(first).join(",")]);
  }

  return out;
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

// --- Создание профиля водителя (POST v2/parks/contractors/driver-profile) ---
// Документация: https://fleet.yandex.ru/docs/api/ru/openapi/ContractorProfiles/v2parkscontractorsdriver-profile-post

/** Преобразует DD.MM.YYYY или YYYY-MM-DD в YYYY-MM-DD для Fleet API. */
function toFleetDate(s: string | null | undefined): string | undefined {
  if (!s || typeof s !== "string") return undefined;
  const t = s.trim();
  if (!t) return undefined;
  const dmY = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2].padStart(2, "0")}-${dmY[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return undefined;
}

/** Разбивает ФИО на first_name, last_name, middle_name (Fleet API). */
function splitFio(fio: string | null | undefined): { first_name: string; last_name: string; middle_name?: string } {
  const parts = (fio || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "Исполнитель", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return {
    first_name: parts[0],
    last_name: parts[parts.length - 1],
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined,
  };
}

export type FleetDriverProfileCreateBody = {
  account?: {
    balance_limit?: string;
    work_rule_id: string;
    payment_service_id?: string;
    block_orders_on_balance_below_limit?: boolean;
  };
  person: {
    full_name: { first_name: string; last_name: string; middle_name?: string };
    contact_info: { phone: string; address?: string; email?: string };
    driver_license: {
      birth_date?: string;
      country: string;
      expiry_date: string;
      issue_date: string;
      number: string;
    };
    driver_license_experience?: { total_since_date?: string };
    id_doc?: { address?: string };
    tax_identification_number?: string;
  };
  profile?: { hire_date?: string; comment?: string };
  car_id: string;
  order_provider?: { platform?: boolean; partner?: boolean };
};

/** Собирает тело запроса для создания профиля водителя из черновика регистрации. */
export function buildDriverProfileBodyFromDraft(
  draft: {
    executorFio: string | null;
    executorPhone: string | null;
    executorLicense: string | null;
    executorLicenseCountry: string | null;
    executorLicenseIssueDate: string | null;
    executorLicenseValidUntil: string | null;
    executorExperience?: string | null;
  },
  options: { workRuleId: string; carId: string; balanceLimit?: string }
): FleetDriverProfileCreateBody {
  const { workRuleId, carId, balanceLimit } = options;
  const name = splitFio(draft.executorFio);
  const phone = (draft.executorPhone || "").trim();
  const normalizedPhone = phone.startsWith("+") ? phone : "+7" + phone.replace(/\D/g, "").replace(/^8/, "").slice(-10);
  const issueDate = toFleetDate(draft.executorLicenseIssueDate);
  const expiryDate = toFleetDate(draft.executorLicenseValidUntil);
  const country = (draft.executorLicenseCountry || "rus").slice(0, 3).toLowerCase();
  const licenseNumber = (draft.executorLicense || "").replace(/\s/g, "").slice(0, 20);

  return {
    account: {
      work_rule_id: workRuleId,
      ...(balanceLimit != null && { balance_limit: String(balanceLimit) }),
      block_orders_on_balance_below_limit: false,
    },
    person: {
      full_name: { first_name: name.first_name, last_name: name.last_name, ...(name.middle_name && { middle_name: name.middle_name }) },
      contact_info: { phone: normalizedPhone || "+79000000000" },
      driver_license: {
        country: country || "rus",
        number: licenseNumber || "000000",
        issue_date: issueDate || "2020-01-01",
        expiry_date: expiryDate || "2030-01-01",
      },
      ...(draft.executorExperience && {
        driver_license_experience: {
          total_since_date: toFleetDate(draft.executorExperience) || "2020-01-01",
        },
      }),
    },
    profile: { hire_date: new Date().toISOString().slice(0, 10), comment: "Из кабинета агента" },
    car_id: carId,
    order_provider: { platform: true, partner: true },
  };
}

/**
 * Создание профиля водителя в Yandex Fleet (POST v2/parks/contractors/driver-profile).
 * Требует X-Idempotency-Token (16–64 печатных ASCII). Возвращает contractor_profile_id.
 */
export async function createDriverProfile(
  creds: FleetCredentials,
  body: FleetDriverProfileCreateBody,
  idempotencyToken: string
): Promise<{ contractor_profile_id: string }> {
  const token = idempotencyToken.replace(/[^\x20-\x7E]/g, "").slice(0, 64);
  if (token.length < 16) throw new Error("X-Idempotency-Token must be 16–64 printable ASCII characters");

  const res = await fetchWithRetry(() =>
    fetch(DRIVER_PROFILE_CREATE, {
      method: "POST",
      headers: {
        ...headersFrom(creds),
        "X-Idempotency-Token": token,
      },
      body: JSON.stringify(body),
    })
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Fleet driver-profile create ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { contractor_profile_id?: string };
  if (!data?.contractor_profile_id) throw new Error("Fleet API did not return contractor_profile_id");
  return { contractor_profile_id: data.contractor_profile_id };
}
