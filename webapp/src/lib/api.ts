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

/** URL для редиректа водителя на страницу входа Яндекс (OAuth 2.0). */
export async function getYandexOAuthAuthorizeUrl(): Promise<{ url: string }> {
  const res = await api.get<{ url: string }>("/api/yandex-oauth/authorize-url");
  return res.data;
}
