/**
 * Yandex Fleet API: driver-profiles/list.
 * https://fleet.yandex.ru/docs/api/ru/
 * Base URL: https://fleet-api.taxi.yandex.net
 */
import { config } from "../config.js";

const FLEET_API_BASE = "https://fleet-api.taxi.yandex.net";
const DRIVER_PROFILES_LIST = `${FLEET_API_BASE}/v1/parks/driver-profiles/list`;
const DRIVER_PROFILE_CREATE = `${FLEET_API_BASE}/v2/parks/contractors/driver-profile`;
const DRIVER_PROFILES_UPDATE = `${FLEET_API_BASE}/v1/parks/driver-profiles/update`;
const FLEET_PARKS = `${FLEET_API_BASE}/v1/parks`;
const FLEET_CARS_UPDATE = `${FLEET_API_BASE}/v1/parks/cars/update`;
const FLEET_CONTRACTORS_BLOCKED_BALANCE = `${FLEET_API_BASE}/v1/parks/contractors/blocked-balance`;
const FLEET_DRIVER_WORK_RULES = `${FLEET_API_BASE}/v1/parks/driver-work-rules`;
/** GET профиль одного водителя (v2 ContractorProfiles): person.full_name, driver_license, profile, account.work_rule_id, car_id */
const FLEET_DRIVER_PROFILE_V2 = `${FLEET_API_BASE}/v2/parks/contractors/driver-profile`;
/** GET данные автомобиля (v2 Cars): vehicle_specifications (brand, model, color, year, transmission), vehicle_licenses (licence_plate_number, registration_certificate). */
const FLEET_VEHICLES_CAR_V2 = `${FLEET_API_BASE}/v2/parks/vehicles/car`;

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
  /** Отчество (из Fleet), для отображения в списке и в карточке. */
  middle_name?: string | null;
  phone: string;
  balance?: number;
  workStatus?: string;
  /** Текущий статус в приложении: online | offline | busy | driving. Приходит в ответе Fleet автоматически, в fields не запрашивать. */
  current_status?: string;
  car_id?: string | null;
};

/** Данные автомобиля из Fleet (для карточки водителя). */
export type DriverFullProfileCar = {
  id?: string;
  brand?: string;
  model?: string;
  color?: string;
  year?: number;
  number?: string;
  registration_certificate_number?: string;
  /** Тип КПП: mechanical | automatic | robotic | variator (v2 vehicle_specifications). */
  transmission?: string;
};

/** Полный профиль одного водителя для карточки (без даты рождения). */
export type DriverFullProfile = YandexDriverProfile & {
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  /** ВУ из Fleet: country (CountryCode, напр. rus), series_number (из number), issue_date/expiration_date (YYYY-MM-DD из issue_date/expiry_date). */
  driver_license?: { series_number?: string; country?: string; issue_date?: string; expiration_date?: string } | null;
  driver_experience?: number | null;
  comment?: string | null;
  photo_url?: string | null;
  car?: DriverFullProfileCar | null;
  /** Идентификатор условия работы (из v2 account.work_rule_id). */
  work_rule_id?: string | null;
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
  const { limit = 30, offset = 0, onEmptyResponseKeys, onParseDiagnostics, onRequestParams } = opts;
  const body = {
    query: { park: { id: creds.parkId } },
    fields: {
      driver_profile: ["id", "work_status", "first_name", "last_name", "middle_name", "phones"],
      account: ["balance", "currency"],
      car: ["id"],
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
    const middleName = (profile?.middle_name != null ? String(profile.middle_name) : raw.middle_name != null ? String(raw.middle_name) : "").trim();
    let name = [firstName, middleName, lastName].filter(Boolean).join(" ") || null;
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
    const currentStatusRaw = profile?.current_status ?? raw.current_status;
    const currentStatusStr =
      currentStatusRaw != null && typeof currentStatusRaw === "object" && "status" in currentStatusRaw
        ? String((currentStatusRaw as { status?: unknown }).status ?? "")
        : typeof currentStatusRaw === "string"
          ? currentStatusRaw
          : undefined;
    const current_status = (currentStatusStr != null && currentStatusStr !== "" ? currentStatusStr : "offline").toLowerCase();
    const car = (raw.car ?? (d as { car?: { id?: string } }).car) as { id?: string } | undefined;
    const car_id = car?.id != null ? String(car.id) : null;
    out.push({ yandexId: id, name, middle_name: middleName || null, phone, balance, workStatus, current_status, car_id });
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
 * Получить полный профиль одного водителя по ID (для карточки). Без даты рождения.
 * Запрашивает расширенные поля у Fleet; если не найден — null.
 */
export async function getDriverProfileById(creds: FleetCredentials, driverId: string): Promise<DriverFullProfile | null> {
  const body = driverProfileListBody(creds.parkId, driverId);
  const res = await fetchWithRetry(() =>
    fetch(DRIVER_PROFILES_LIST, {
      method: "POST",
      headers: headersFrom(creds),
      body: JSON.stringify(body),
    })
  );
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  const rawList = parseDriverProfilesList(data);
  const d = rawList[0];
  if (!d) return null;
  const raw = d as Record<string, unknown>;
  const profile = (d.driver_profile ?? raw) as Record<string, unknown> | undefined;
  const id = profile?.id != null ? String(profile.id) : raw.id != null ? String(raw.id) : undefined;
  if (!id) return null;
  const firstName = (profile?.first_name != null ? String(profile.first_name) : "").trim();
  const lastName = (profile?.last_name != null ? String(profile.last_name) : "").trim();
  const middleName = (profile?.middle_name != null ? String(profile.middle_name) : "").trim();
  const name = [firstName, middleName, lastName].filter(Boolean).join(" ") || null;
  const phones = profile?.phones ?? raw.phones;
  const phone = parsePhoneFromPhones(phones) || "";
  const accountsList = Array.isArray(d.accounts) ? d.accounts : Array.isArray((raw as { account?: unknown }).account) ? (raw as { account: Array<{ balance?: unknown }> }).account : [];
  const balanceRaw = accountsList[0]?.balance ?? (raw as { balance?: unknown }).balance;
  const balance = balanceRaw != null ? parseFloat(String(balanceRaw)) : undefined;
  const workStatus = (profile?.work_status != null ? String(profile.work_status) : raw.work_status != null ? String(raw.work_status) : undefined) as string | undefined;
  const currentStatusRaw = profile?.current_status ?? raw.current_status;
  const currentStatusStr =
    currentStatusRaw != null && typeof currentStatusRaw === "object" && "status" in currentStatusRaw
      ? String((currentStatusRaw as { status?: unknown }).status ?? "")
      : typeof currentStatusRaw === "string"
        ? currentStatusRaw
        : undefined;
  const current_status = (currentStatusStr != null && currentStatusStr !== "" ? currentStatusStr : "offline").toLowerCase();
  const license = (raw.driver_license ?? (d as { driver_license?: Record<string, unknown> }).driver_license) as Record<string, unknown> | undefined;
  const licenseNumber = license?.number != null ? String(license.number).replace(/\s/g, "") : undefined;
  const licenseCountry = license?.country != null ? String(license.country) : undefined;
  const issueDateRaw = license?.issue_date ?? license?.issue_date_iso;
  const issueDate = issueDateRaw != null ? String(issueDateRaw).slice(0, 10) : undefined;
  const expiryDateRaw = license?.expiry_date ?? license?.expiration_date;
  const expiryDate = expiryDateRaw != null ? String(expiryDateRaw).slice(0, 10) : undefined;
  const expSince = (raw.driver_license_experience ?? (d as { driver_license_experience?: Array<{ total_since_date?: string }> }).driver_license_experience) as Array<{ total_since_date?: string }> | undefined;
  const totalSince = expSince?.[0]?.total_since_date;
  const driver_experience = totalSince ? Math.max(0, new Date().getFullYear() - new Date(totalSince).getFullYear()) : undefined;
  const profileObj = (raw.profile ?? (d as { profile?: { comment?: string } }).profile) as { comment?: string } | undefined;
  const comment = profileObj?.comment != null ? String(profileObj.comment) : null;
  const photo_url = (profile?.photo ?? raw.photo ?? (profile as { photo_url?: string })?.photo_url) != null ? String((profile as { photo?: string }).photo ?? (raw as { photo?: string }).photo ?? (profile as { photo_url?: string }).photo_url) : null;

  const carsArray = (raw.cars ?? (d as { cars?: unknown[] }).cars) as Record<string, unknown>[] | undefined;
  const carRaw = (raw.car ?? (d as { car?: Record<string, unknown> }).car ?? carsArray?.[0]) as Record<string, unknown> | undefined;
  const car_id = carRaw?.id != null ? String(carRaw.id) : null;
  const hasCarData =
    carRaw &&
    (carRaw.id != null ||
      carRaw.brand != null ||
      carRaw.model != null ||
      carRaw.color != null ||
      carRaw.brand_id != null ||
      carRaw.model_id != null ||
      carRaw.color_id != null);
  let car: DriverFullProfileCar | null = null;
  if (hasCarData && carRaw) {
    const regCert =
      carRaw.registration_certificate ??
      carRaw.registration_certificate_number ??
      (carRaw as { registration_cert?: string }).registration_cert;
    car = {
      id: carRaw.id != null ? String(carRaw.id) : undefined,
      brand: (carRaw.brand != null ? String(carRaw.brand) : carRaw.brand_id != null ? String(carRaw.brand_id) : undefined),
      model: (carRaw.model != null ? String(carRaw.model) : carRaw.model_id != null ? String(carRaw.model_id) : undefined),
      color: (carRaw.color != null ? String(carRaw.color) : carRaw.color_id != null ? String(carRaw.color_id) : undefined),
      year: carRaw.year != null ? Number(carRaw.year) : undefined,
      number: carRaw.number != null ? String(carRaw.number) : undefined,
      registration_certificate_number: regCert != null ? String(regCert) : undefined,
    };
  }

  return {
    yandexId: id,
    name: name || "Водитель #" + id.slice(-6),
    phone,
    balance,
    workStatus,
    current_status,
    car_id,
    first_name: firstName || null,
    last_name: lastName || null,
    middle_name: middleName || null,
    driver_license: licenseNumber || licenseCountry || issueDate || expiryDate ? { series_number: licenseNumber, country: licenseCountry, issue_date: issueDate, expiration_date: expiryDate } : null,
    driver_experience: driver_experience ?? null,
    comment: comment ?? null,
    photo_url: photo_url || null,
    car: car ?? null,
  };
}

/**
 * Получить профиль водителя по v2 API (GET /v2/parks/contractors/driver-profile).
 * Структура ответа: person.full_name, person.contact_info.phone, person.driver_license (country, number, issue_date, expiry_date),
 * person.driver_license_experience.total_since_date, profile.comment/work_status, account.work_rule_id, car_id.
 * Не возвращает: balance (используйте blocked-balance), current_status (только в v1 list), photo_url, детали car (только car_id).
 */
export async function getDriverProfileV2(creds: FleetCredentials, contractorProfileId: string): Promise<DriverFullProfile | null> {
  const url = `${FLEET_DRIVER_PROFILE_V2}?contractor_profile_id=${encodeURIComponent(contractorProfileId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: headersFrom(creds),
    })
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    person?: {
      full_name?: { first_name?: string; last_name?: string; middle_name?: string };
      contact_info?: { phone?: string };
      driver_license?: { country?: string; number?: string; issue_date?: string; expiry_date?: string };
      driver_license_experience?: { total_since_date?: string };
    };
    profile?: { comment?: string; work_status?: string };
    account?: { work_rule_id?: string };
    car_id?: string;
  };
  const person = data.person;
  const fullName = person?.full_name;
  const firstName = (fullName?.first_name ?? "").trim();
  const lastName = (fullName?.last_name ?? "").trim();
  const middleName = (fullName?.middle_name ?? "").trim();
  const name = [firstName, middleName, lastName].filter(Boolean).join(" ") || null;
  const phone = (person?.contact_info?.phone ?? "").trim() || "";
  const license = person?.driver_license;
  const licenseNumber = license?.number != null ? String(license.number).replace(/\s/g, "") : undefined;
  const licenseCountry = license?.country != null ? String(license.country) : undefined;
  const issueDate = license?.issue_date != null ? String(license.issue_date).slice(0, 10) : undefined;
  const expiryDate = license?.expiry_date != null ? String(license.expiry_date).slice(0, 10) : undefined;
  const totalSince = person?.driver_license_experience?.total_since_date;
  const driver_experience = totalSince ? Math.max(0, new Date().getFullYear() - new Date(totalSince).getFullYear()) : undefined;
  const comment = data.profile?.comment != null ? String(data.profile.comment) : null;
  const workStatus = data.profile?.work_status != null ? String(data.profile.work_status) : undefined;
  const work_rule_id = data.account?.work_rule_id != null ? String(data.account.work_rule_id) : null;
  const car_id = data.car_id != null ? String(data.car_id) : null;

  return {
    yandexId: contractorProfileId,
    name: name || "Водитель #" + contractorProfileId.slice(-6),
    phone,
    workStatus,
    current_status: "offline",
    car_id,
    first_name: firstName || null,
    last_name: lastName || null,
    middle_name: middleName || null,
    driver_license: licenseNumber || licenseCountry || issueDate || expiryDate ? { series_number: licenseNumber, country: licenseCountry, issue_date: issueDate, expiration_date: expiryDate } : null,
    driver_experience: driver_experience ?? null,
    comment: comment ?? null,
    photo_url: null,
    car: null,
    work_rule_id: work_rule_id ?? null,
  };
}

/**
 * Получить данные автомобиля по v2 API (GET /v2/parks/vehicles/car).
 * VehicleSpecifications: brand, model, color, year, transmission; VehicleLicenses: licence_plate_number, registration_certificate.
 */
export async function getVehicleById(creds: FleetCredentials, vehicleId: string): Promise<DriverFullProfileCar | null> {
  const url = `${FLEET_VEHICLES_CAR_V2}?vehicle_id=${encodeURIComponent(vehicleId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: headersFrom(creds),
    })
  );
  if (!res.ok) return null;
  const raw = (await res.json()) as Record<string, unknown>;
  const payload = unwrapData(raw) as Record<string, unknown> | null;
  const root = payload ?? raw;
  const spec = root?.vehicle_specifications as { brand?: string; model?: string; color?: string; year?: number; transmission?: string } | undefined;
  const licenses = root?.vehicle_licenses as { licence_plate_number?: string; registration_certificate?: string } | undefined;
  if (!spec && !licenses) return null;
  const brand = spec?.brand != null ? String(spec.brand) : undefined;
  const model = spec?.model != null ? String(spec.model) : undefined;
  const color = spec?.color != null ? String(spec.color) : undefined;
  const year = spec?.year != null ? Number(spec.year) : undefined;
  const transmission = spec?.transmission != null ? String(spec.transmission) : undefined;
  const number = licenses?.licence_plate_number != null ? String(licenses.licence_plate_number) : undefined;
  const registration_certificate_number = licenses?.registration_certificate != null ? String(licenses.registration_certificate) : undefined;
  if (!brand && !model && !color && !year && !number && !registration_certificate_number) return null;
  return {
    id: vehicleId,
    brand,
    model,
    color,
    year,
    number,
    registration_certificate_number,
    transmission,
  };
}

/** Тело запроса driver-profiles/list для одного водителя (для диагностики и getDriverProfileById). */
function driverProfileListBody(parkId: string, driverId: string) {
  return {
    query: { park: { id: parkId }, driver_profile: { id: [driverId] } },
    fields: {
      driver_profile: ["id", "work_status", "first_name", "last_name", "middle_name", "phones"],
      account: ["balance", "currency"],
      car: ["id", "brand", "model", "color", "year", "number", "registration_cert"],
      driver_license: ["country", "number", "issue_date", "expiry_date"],
      driver_license_experience: ["total_since_date"],
      profile: ["comment"],
    },
    limit: 1,
    offset: 0,
  };
}

/**
 * Сырой ответ Fleet: driver-profiles/list (один водитель). Для диагностики — смотреть в каком виде приходят car/brand/model.
 */
export async function getDriverProfilesListRaw(
  creds: FleetCredentials,
  driverId: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const body = driverProfileListBody(creds.parkId, driverId);
  const res = await fetchWithRetry(() =>
    fetch(DRIVER_PROFILES_LIST, {
      method: "POST",
      headers: headersFrom(creds),
      body: JSON.stringify(body),
    })
  );
  const bodyJson = (await res.json()) as unknown;
  return { ok: res.ok, status: res.status, body: bodyJson };
}

/**
 * Сырой ответ Fleet: GET /v2/parks/vehicles/car. Для диагностики — смотреть структуру vehicle_specifications / data.
 */
export async function getVehicleByIdRaw(
  creds: FleetCredentials,
  vehicleId: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${FLEET_VEHICLES_CAR_V2}?vehicle_id=${encodeURIComponent(vehicleId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, { method: "GET", headers: headersFrom(creds) })
  );
  const bodyJson = (await res.json()) as unknown;
  return { ok: res.ok, status: res.status, body: bodyJson };
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

// --- Справочники Fleet (countries, car-brands, car-models, colors) и обновление водителя/авто ---

export type FleetListType = "countries" | "car-brands" | "car-models" | "colors";

export type FleetListItem = { id: string; name?: string; [key: string]: unknown };

/** Нормализация элемента справочника Fleet (id/code, name/title). */
function normalizeFleetListItem(raw: Record<string, unknown>): FleetListItem {
  const id = (raw.code ?? raw.id ?? "") as string;
  const name = (raw.name ?? raw.title ?? raw.code ?? id) as string;
  return { id: String(id), name: String(name), ...raw };
}

/** Справочник из Fleet API: countries, car-brands, car-models (с brand), colors. */
export async function getFleetList(
  creds: FleetCredentials,
  type: FleetListType,
  params?: { brand?: string }
): Promise<FleetListItem[]> {
  const pathMap: Record<FleetListType, string> = {
    countries: "countries/list",
    "car-brands": "car-brands/list",
    "car-models": "car-models/list",
    colors: "colors/list",
  };
  const path = pathMap[type];
  const url = `${FLEET_PARKS}/${path}`;
  const body: Record<string, unknown> = type === "car-models" && params?.brand ? { brand_id: params.brand } : {};
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "POST",
      headers: headersFrom(creds),
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : "{}",
    })
  );
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404) {
      console.warn("[getFleetList] Fleet returned 404 (path_not_found), returning empty list", { type });
      return [];
    }
    console.error("[getFleetList] Fleet error", { type, status: res.status, body: text.slice(0, 500) });
    throw new Error(`Fleet ${type} list ${res.status}: ${text.slice(0, 300)}`);
  }
  let data: Record<string, unknown>;
  try {
    data = (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch (e) {
    console.error("[getFleetList] JSON parse error", { type, text: text.slice(0, 200) });
    return [];
  }
  console.log("[getFleetList] Fleet raw response keys", { type, keys: Object.keys(data) });
  const key = type === "countries" ? "countries" : type === "car-brands" ? "brands" : type === "car-models" ? "models" : "colors";
  const dataWrapper = data.data as Record<string, unknown> | undefined;
  const raw = (data[key] ?? dataWrapper?.[key] ?? (Array.isArray(data.data) ? data.data : undefined)) as unknown;
  const arr = Array.isArray(raw) ? raw : [];
  const items = arr
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map(normalizeFleetListItem)
    .filter((x) => x.id !== undefined && x.id !== "");
  console.log("[getFleetList] parsed items", { type, count: items.length, sample: items.slice(0, 2) });
  if (arr.length > 0 && items.length === 0) {
    console.error("[getFleetList] Fleet returned array but no valid items", { type, rawSample: arr[0] });
  }
  return items;
}

/** Баланс и заблокированный баланс водителя (ContractorProfiles API). */
export type ContractorBalance = { balance: number; blocked_balance?: number };

export async function getContractorBlockedBalance(creds: FleetCredentials, contractorId: string): Promise<ContractorBalance | null> {
  const url = `${FLEET_CONTRACTORS_BLOCKED_BALANCE}?contractor_id=${encodeURIComponent(contractorId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: headersFrom(creds),
    })
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { balance?: string; blocked_balance?: string };
  const balance = data.balance != null ? parseFloat(String(data.balance)) : 0;
  const blocked_balance = data.blocked_balance != null ? parseFloat(String(data.blocked_balance)) : 0;
  return { balance, blocked_balance };
}

/** Условия работы в парке (DriverWorkRules API). */
export type DriverWorkRule = { id: string; name: string; is_enabled: boolean };

export async function getDriverWorkRules(creds: FleetCredentials): Promise<DriverWorkRule[]> {
  const url = `${FLEET_DRIVER_WORK_RULES}?park_id=${encodeURIComponent(creds.parkId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: { ...headersFrom(creds), "Accept-Language": "ru" },
    })
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { rules?: Array<{ id?: string; name?: string; is_enabled?: boolean }> };
  const rules = Array.isArray(data.rules) ? data.rules : [];
  return rules
    .filter((r) => r?.id != null)
    .map((r) => ({
      id: String(r.id),
      name: (r.name ?? "").trim() || String(r.id),
      is_enabled: Boolean(r.is_enabled),
    }));
}

export type DriverProfileUpdatePayload = {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  phones?: string[];
  driver_experience?: number;
  driver_license?: { series_number?: string; country?: string; issue_date?: string; expiration_date?: string };
};

export type CarUpdatePayload = {
  brand?: string;
  model?: string;
  color?: string;
  year?: number;
  number?: string;
  registration_certificate_number?: string;
};

/** Обновление профиля водителя в Fleet (POST v1/parks/driver-profiles/update). */
export async function updateDriverProfile(
  creds: FleetCredentials,
  driverId: string,
  payload: DriverProfileUpdatePayload
): Promise<void> {
  const body: Record<string, unknown> = {
    driver_profile_id: driverId,
    ...(payload.first_name != null && { first_name: payload.first_name }),
    ...(payload.last_name != null && { last_name: payload.last_name }),
    ...(payload.middle_name != null && { middle_name: payload.middle_name }),
    ...(payload.phones != null && { phones: payload.phones }),
    ...(payload.driver_experience != null && {
      driver_license_experience: {
        total_since_date: new Date(Date.now() - payload.driver_experience * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
    }),
    ...(payload.driver_license != null && {
      driver_license: {
        ...(payload.driver_license.series_number != null && { number: payload.driver_license.series_number.replace(/\s/g, "") }),
        ...(payload.driver_license.country != null && { country: payload.driver_license.country }),
        ...(payload.driver_license.issue_date != null && { issue_date: payload.driver_license.issue_date }),
        ...(payload.driver_license.expiration_date != null && { expiry_date: payload.driver_license.expiration_date }),
      },
    }),
  };
  const res = await fetchWithRetry(() =>
    fetch(DRIVER_PROFILES_UPDATE, {
      method: "POST",
      headers: headersFrom(creds),
      body: JSON.stringify(body),
    })
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Fleet driver-profiles update ${res.status}: ${text.slice(0, 300)}`);
}

/** Обновление автомобиля в Fleet (POST v1/parks/cars/update). */
export async function updateCar(
  creds: FleetCredentials,
  carId: string,
  payload: CarUpdatePayload
): Promise<void> {
  const body: Record<string, unknown> = {
    car_id: carId,
    ...(payload.brand != null && { brand: payload.brand }),
    ...(payload.model != null && { model: payload.model }),
    ...(payload.color != null && { color: payload.color }),
    ...(payload.year != null && { year: payload.year }),
    ...(payload.number != null && { number: payload.number }),
    ...(payload.registration_certificate_number != null && { registration_certificate: payload.registration_certificate_number }),
  };
  const res = await fetchWithRetry(() =>
    fetch(FLEET_CARS_UPDATE, {
      method: "POST",
      headers: headersFrom(creds),
      body: JSON.stringify(body),
    })
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Fleet cars update ${res.status}: ${text.slice(0, 300)}`);
}
