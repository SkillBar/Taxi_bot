/**
 * API‑клиент для запросов к бэкенду с автоматической подстановкой x-telegram-init-data.
 * Используется в кабинете менеджера (ManagerDashboard).
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

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
});

api.interceptors.request.use((config) => {
  config.headers["x-telegram-init-data"] = getInitDataRaw();
  return config;
});

/** Данные менеджера (имя + подключён ли Fleet). */
export async function getManagerMe(): Promise<{ hasFleet: boolean }> {
  const res = await api.get<{ hasFleet: boolean }>("/api/manager/me");
  return res.data;
}

/** Подключить Yandex Fleet (API-ключ + ID парка). */
export async function connectFleet(apiKey: string, parkId: string): Promise<{ success: boolean }> {
  const res = await api.post<{ success: boolean }>("/api/manager/connect-fleet", { apiKey, parkId });
  return res.data;
}

/** URL для редиректа водителя на страницу входа Яндекс (OAuth 2.0). */
export async function getYandexOAuthAuthorizeUrl(): Promise<{ url: string }> {
  const res = await api.get<{ url: string }>("/api/yandex-oauth/authorize-url");
  return res.data;
}
