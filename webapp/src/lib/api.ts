/**
 * API‑клиент для запросов к бэкенду с автоматической подстановкой x-telegram-init-data.
 * Используется в кабинете менеджера (ManagerDashboard).
 */
import axios from "axios";

const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

function getInitDataRaw(): string {
  try {
    if (typeof window !== "undefined" && window.Telegram?.WebApp?.initData) {
      return window.Telegram.WebApp.initData;
    }
  } catch {
    // ignore
  }
  return "";
}

export const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 20000, // 20 сек — иначе «Нет связи с сервером»
});

api.interceptors.request.use((config) => {
  config.headers["x-telegram-init-data"] = getInitDataRaw();
  return config;
});

/** Данные менеджера (имя + подключён ли Fleet). welcomeMessage — если номер не был в базе и только что подключили. */
export async function getManagerMe(): Promise<{ hasFleet: boolean; welcomeMessage?: string }> {
  const res = await api.get<{ hasFleet: boolean; welcomeMessage?: string }>("/api/manager/me");
  return res.data;
}

/** Регистрация/привязка по номеру: находит или создаёт менеджера, привязывает к дефолтному парку. */
export async function registerByPhone(phoneNumber: string): Promise<{ success: boolean; hasFleet: boolean; managerId?: string }> {
  const res = await api.post<{ success: boolean; hasFleet: boolean; managerId?: string }>("/api/manager/register-by-phone", {
    phoneNumber: phoneNumber.trim(),
  });
  return res.data;
}

/** Привязать к менеджеру преднастроенный парк из конфига (только номер подтверждён — ключ не вводится). */
export async function attachDefaultFleet(): Promise<{ success: boolean }> {
  const res = await api.post<{ success: boolean }>("/api/manager/attach-default-fleet");
  return res.data;
}

/** Подключить Yandex Fleet. parkId опционален — при пустом бэкенд попытается определить по ключу. clientId — если в кабинете указан отличный от taxi/park/{parkId}. */
export async function connectFleet(
  apiKey: string,
  parkId: string,
  clientId?: string
): Promise<{ success: boolean }> {
  const body: { apiKey: string; parkId: string; clientId?: string } = { apiKey, parkId: parkId || "" };
  if (clientId?.trim()) body.clientId = clientId.trim();
  const res = await api.post<{ success: boolean }>("/api/manager/connect-fleet", body);
  return res.data;
}

/** URL для редиректа водителя на страницу входа Яндекс (OAuth 2.0). */
export async function getYandexOAuthAuthorizeUrl(): Promise<{ url: string }> {
  const res = await api.get<{ url: string }>("/api/yandex-oauth/authorize-url");
  return res.data;
}

export type FleetListType = "countries" | "car-brands" | "car-models" | "colors";

export type FleetListItem = { id: string; name?: string; code?: string; title?: string; [key: string]: unknown };

/** Элемент для dropdown: value (id/code), label (name/title). */
export type FleetListOption = { value: string; label: string };

/** Справочники Fleet для dropdown (countries, car-brands, car-models, colors). */
export async function getFleetList(
  type: FleetListType,
  params?: { brand?: string }
): Promise<FleetListOption[]> {
  const url = type === "car-models" && params?.brand
    ? `/api/manager/fleet-lists/${type}?brand=${encodeURIComponent(params.brand)}`
    : `/api/manager/fleet-lists/${type}`;
  const res = await api.get<{ items?: FleetListItem[] }>(url);
  const rawItems = res.data?.items ?? [];
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item: FleetListItem) => ({
    value: (item.code ?? item.id ?? "").toString(),
    label: (item.name ?? item.title ?? item.code ?? item.id ?? "").toString(),
  })).filter((o) => o.value !== "" || o.label !== "");
}

/** Данные автомобиля из парка (для карточки водителя). */
export type FullDriverCar = {
  id?: string;
  brand?: string;
  model?: string;
  color?: string;
  year?: number;
  number?: string;
  registration_certificate_number?: string;
};

/** Полный профиль водителя из парка (driver + driver_license + car). Без даты рождения. */
export type FullDriver = {
  yandexId: string;
  name: string | null;
  phone: string;
  balance?: number;
  workStatus?: string;
  car_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  driver_license?: { series_number?: string; country?: string; issue_date?: string; expiration_date?: string } | null;
  driver_experience?: number | null;
  comment?: string | null;
  photo_url?: string | null;
  car?: FullDriverCar | null;
};

/** Полный профиль водителя из парка (для карточки). Ответ: { driver: FullDriver }. */
export async function getDriver(driverId: string): Promise<{ driver: FullDriver }> {
  const res = await api.get<{ driver: FullDriver }>(`/api/manager/driver/${driverId}`);
  return res.data;
}

/** Баланс и заблокированный баланс водителя (Fleet ContractorProfiles blocked-balance). */
export type DriverBalance = { balance: number; blocked_balance?: number };

export async function getDriverBalance(driverId: string): Promise<DriverBalance | null> {
  try {
    const res = await api.get<DriverBalance>(`/api/manager/driver/${driverId}/balance`);
    return res.data;
  } catch {
    return null;
  }
}

/** Условия работы в парке (Fleet DriverWorkRules). */
export type DriverWorkRule = { id: string; name: string; is_enabled: boolean };

export async function getDriverWorkRules(): Promise<DriverWorkRule[]> {
  try {
    const res = await api.get<{ rules: DriverWorkRule[] }>("/api/manager/driver-work-rules");
    return Array.isArray(res.data?.rules) ? res.data.rules : [];
  } catch {
    return [];
  }
}

/** Обновить профиль водителя и/или авто в Fleet. */
export async function updateDriver(
  driverId: string,
  body: {
    driver_profile?: Record<string, unknown>;
    car?: Record<string, unknown>;
    car_id?: string;
  }
): Promise<{ success: boolean; message?: string }> {
  const res = await api.post<{ success: boolean; message?: string }>(`/api/manager/driver/${driverId}/update`, body);
  return res.data;
}
