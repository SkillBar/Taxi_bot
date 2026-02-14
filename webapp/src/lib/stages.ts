/**
 * Этапы запросов к API — для понятных сообщений об ошибках.
 * Каждый этап показывается пользователю при сбое, чтобы было ясно, на каком шаге произошла ошибка.
 */

export const STAGES = {
  /** Проверка входа: привязан ли пользователь к агенту */
  AGENTS_ME: "1. Проверка входа в кабинет",
  /** Проверка кабинета менеджера: подключён ли Fleet */
  MANAGER_ME: "2. Проверка кабинета менеджера",
  /** Подключение парка Yandex Fleet по API-ключу */
  CONNECT_FLEET: "3. Подключение к парку Yandex Fleet",
  /** Загрузка списка водителей */
  MANAGER_DRIVERS: "4. Загрузка списка водителей",
  /** Привязка водителя по телефону */
  LINK_DRIVER: "5. Привязка водителя",
} as const;

export const ENDPOINTS: Record<keyof typeof STAGES, string> = {
  AGENTS_ME: "GET /api/agents/me",
  MANAGER_ME: "GET /api/manager/me",
  CONNECT_FLEET: "POST /api/manager/connect-fleet",
  MANAGER_DRIVERS: "GET /api/manager/drivers",
  LINK_DRIVER: "POST /api/manager/link-driver",
};

/** Форматирует сообщение об ошибке с указанием этапа и запроса */
export function formatStageError(
  stage: string,
  endpoint: string,
  message: string
): string {
  return `Сбой на этапе: ${stage}\nЗапрос: ${endpoint}\n\n${message}`;
}

/** Адрес API при сборке (для сообщений «нет связи») */
export function getApiBaseForError(): string {
  const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
  return base || "(не задан — задайте VITE_API_URL при сборке и пересоберите)";
}

/** Текст «нет связи с сервером» с подсказками и адресом API */
export function noConnectionMessage(): string {
  const base = getApiBaseForError();
  return [
    "Нет связи с сервером.",
    "Проверьте: 1) интернет; 2) откройте приложение из Telegram (не в браузере); 3) при сборке задан верный адрес API (VITE_API_URL).",
    "",
    "Адрес API при сборке: " + base,
  ].join("\n");
}

/**
 * Строит сообщение об ошибке из исключения (fetch или axios).
 * Для сетевых ошибок — noConnectionMessage(); для ответа сервера — status + body.
 */
export function buildErrorMessage(e: unknown): string {
  const err = e as {
    response?: { status?: number; data?: unknown; statusText?: string };
    message?: string;
  };
  if (err?.response) {
    const status = err.response.status;
    const data = err.response.data;
    const body =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message?: string }).message)
        : typeof data === "string"
          ? data
          : err.response.statusText || `HTTP ${status}`;
    return `Ответ сервера: ${status}. ${body}`;
  }
  // fetch: мы бросаем Error с body в message и status на err.status
  const status = (e as { status?: number }).status;
  const msg = typeof err?.message === "string" ? err.message.trim() : "";
  if (msg) {
    const parsed = (() => {
      try {
        if (msg.startsWith("{")) return JSON.parse(msg) as { error?: string; message?: string; details?: string };
      } catch {
        /* ignore */
      }
      return null;
    })();
    const serverMsg =
      parsed?.details != null && parsed.details !== ""
        ? `${parsed?.error ?? "Ошибка"}: ${parsed.details}`
        : parsed?.error ?? parsed?.message ?? msg;
    const prefix = status != null ? `Ответ сервера: ${status}. ` : "Ответ сервера: ";
    if (serverMsg !== msg || msg.includes("Invalid") || msg.includes("error") || /^\d{3}\s/.test(msg)) {
      return `${prefix}${serverMsg}`;
    }
    if (msg.length < 200) return status != null ? `${prefix}${msg}` : msg;
  }
  return noConnectionMessage();
}
