import { useEffect, useState, useCallback, useRef } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Input } from "@telegram-apps/telegram-ui";
import { getAgentsMe } from "../api";
import { getManagerMe, connectFleet } from "../lib/api";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        requestContact?: (callback: (sent: boolean) => void) => void;
        MainButton?: {
          show: () => void;
          hide: () => void;
          setText: (text: string) => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
          showProgress?: (show: boolean) => void;
        };
      };
    };
  }
}

export interface OnboardingScreenProps {
  onLinked: () => void;
}

type Step = "contact" | "fleet";

// Фиксированные значения для парка (вводится только API-ключ)
const DEFAULT_PARK_ID = "28499fad6fb246c6827dcd3452ba1384";
const DEFAULT_CLIENT_ID = "taxi/park/28499fad6fb246c6827dcd3452ba1384";

export function OnboardingScreen({ onLinked }: OnboardingScreenProps) {
  const [step, setStep] = useState<Step>("contact");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactSent, setContactSent] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const errorBlockRef = useRef<HTMLDivElement>(null);

  const handleRequestContact = useCallback(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa?.requestContact) {
      setError("Подтверждение контакта недоступно. Обновите Telegram.");
      return;
    }
    setError(null);
    setLoading(true);
    wa.requestContact((sent) => {
      if (sent) {
        setLoading(false);
        setContactSent(true);
        setStep("fleet");
      } else {
        setLoading(false);
        setError("Нужно поделиться контактом для продолжения.");
      }
    });
  }, []);

  const handleConnectFleet = useCallback(async () => {
    if (typeof console !== "undefined") console.log("[Fleet] Подключить нажато");
    // Отладка при ?skipContact=1 или ?debug=1: если alert не показывается — клик не доходит до обработчика
    const showDebugAlert = typeof window !== "undefined" && (window.location.search.includes("skipContact=1") || window.location.search.includes("debug=1"));
    if (showDebugAlert) window.alert("Кнопка «Подключить» нажата. Дальше идёт запрос к API…");
    const key = apiKey.trim();
    if (!key) {
      setError("Введите API-ключ");
      setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      return;
    }
    setError(null);
    setLoading(true);
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (mainBtn?.showProgress) mainBtn.showProgress(true);
    try {
      const res = await connectFleet(key, DEFAULT_PARK_ID, DEFAULT_CLIENT_ID);
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      mainBtn?.hide();
      // Запрос прошёл — сразу открываем личный кабинет
      if (res?.success !== false) onLinked();
    } catch (e: unknown) {
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      try {
        const err = e as {
          response?: {
            status?: number;
            data?: {
              message?: string;
              error?: string;
              code?: string;
              step?: string;
              fleetStatus?: number;
              fleetCode?: string;
              fleetMessage?: string;
              fleetHint?: string;
              details?: string;
            };
          };
        };
        const status = err.response?.status;
        const data = err.response?.data;

        // Нет ответа от сервера (сеть, CORS, неверный URL API, таймаут)
        if (!err.response) {
          setError(
            "Нет связи с сервером. Проверьте: 1) интернет; 2) откройте приложение из Telegram (не в браузере); 3) при сборке/деплое задан верный адрес API (VITE_API_URL = URL вашего бэкенда)."
          );
          setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
          return;
        }

        // 401 — не прошла авторизация Telegram (initData)
        if (status === 401) {
          const msg =
            data?.message ??
            "Не удалось войти. Откройте мини-приложение именно из Telegram (не в браузере) и попробуйте снова.";
          setError(msg);
          setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
        return;
      }

      // 400 — ошибка проверки подключения к парку (Fleet)
        if (status === 400 && data?.code === "FLEET_VALIDATION_FAILED") {
          const humanMsg = data?.message ?? "Ошибка подключения к парку. Проверьте API-ключ и ID парка.";
          const fleetStatus = data?.fleetStatus;
          const fleetHint = data?.fleetHint;
          const details = data?.details;
          const parts: string[] = [humanMsg];
          if (fleetStatus != null) parts.push(`Код ответа Fleet: HTTP ${fleetStatus}`);
          if (fleetHint) parts.push(`Ответ Яндекс: ${fleetHint}`);
          if (details) parts.push(`Подробности: ${details}`);
        setError(parts.join("\n\n"));
        setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
        return;
      }

      // Любая другая ошибка
        const msg = data?.message ?? data?.error ?? "Ошибка подключения. Проверьте API-ключ.";
        const details = data?.details;
        setError(details ? `${msg}\n\nПодробности: ${details}` : msg);
        setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
      } catch (inner) {
        const fallbackMsg = inner instanceof Error ? inner.message : String(inner);
        setError(`Ошибка: ${fallbackMsg}`);
        setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
        if (typeof console !== "undefined") console.error("[connect-fleet]", inner);
      }
    } finally {
      setLoading(false);
    }
  }, [apiKey, onLinked]);

  useEffect(() => {
    // Режим теста из браузера: ?skipContact=1 — сразу экран Fleet (запрос «Подключить» всё равно даст 401 без Telegram)
    if (typeof window !== "undefined" && window.location.search.includes("skipContact=1")) {
      setStep("fleet");
      setContactSent(true);
      return;
    }
    getAgentsMe()
      .then((me) => {
        if (me.linked) {
          getManagerMe().then((m) => {
            if (m.hasFleet) onLinked();
            else setStep("fleet");
          });
        } else {
          setStep("contact");
        }
      })
      .catch(() => setStep("contact"));
  }, [onLinked]);

  useEffect(() => {
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (step !== "contact" || !mainBtn) return;
    mainBtn.setText("Подтвердить номер");
    mainBtn.show();
    mainBtn.onClick(handleRequestContact);
    return () => {
      mainBtn.offClick?.(handleRequestContact);
      mainBtn.hide();
    };
  }, [step, handleRequestContact]);

  // MainButton на шаге fleet: стандартная кнопка внизу
  useEffect(() => {
    if (step !== "fleet") return;
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (!mainBtn) return;
    mainBtn.setText("Подключить");
    mainBtn.show();
    mainBtn.onClick(handleConnectFleet);
    return () => {
      mainBtn.offClick?.(handleConnectFleet);
      mainBtn.hide();
    };
  }, [step, handleConnectFleet]);

  // ——— Шаг 2: подключение Yandex Fleet ———
  if (step === "fleet") {
    return (
      <AppRoot>
        <main
          style={{
            minHeight: "100vh",
            background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
            padding: 24,
            paddingBottom: 80,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            {typeof window !== "undefined" && window.location.search.includes("skipContact=1") && (
              <p style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #888)", margin: "0 0 8px" }}>
                Режим теста из браузера. Для сохранения подключения откройте приложение из Telegram.
              </p>
            )}
            {contactSent && !window.location.search.includes("skipContact=1") && (
              <p style={{ fontSize: 14, color: "var(--tg-theme-button-color, #2481cc)", margin: "0 0 12px", fontWeight: 600 }}>
                Номер подтверждён.
              </p>
            )}
            <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--tg-theme-text-color, #000000)" }}>
              Подключите ваш парк Yandex Fleet
            </h1>
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0 }}>
              Введите <strong>API-ключ</strong> из кабинета fleet.yandex.ru → Настройки → API. ID парка и Client ID подставлены автоматически.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Input
              header="API-ключ"
              placeholder="Вставьте API-ключ из кабинета Fleet"
              value={apiKey}
              onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          </div>
          {error && (
            <div
              ref={errorBlockRef}
              style={{
                color: "var(--tg-theme-destructive-text-color, #c00)",
                fontSize: 13,
                marginBottom: 16,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 120,
                overflow: "auto",
                padding: 8,
                background: "var(--tg-theme-bg-color, #fff)",
                borderRadius: 8,
                border: "1px solid var(--tg-theme-destructive-text-color, #c00)",
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          {loading && (
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", textAlign: "center" }}>
              Подключение…
            </p>
          )}

          <button
            type="button"
            className="primary"
            onClick={handleConnectFleet}
            disabled={loading}
            style={{ marginTop: 16 }}
          >
            {loading ? "Подключение…" : "Подключить"}
          </button>
        </main>
      </AppRoot>
    );
  }

  // ——— Шаг 1: подтверждение номера ———
  return (
    <AppRoot>
      <main
        style={{
          minHeight: "100vh",
          background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--tg-theme-text-color, #000000)" }}>
            Добро пожаловать в кабинет агента такси!
          </h1>
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0 }}>
            Подтвердите номер телефона, с которого вы зарегистрированы как агент таксопарка.
          </p>
        </div>

        {loading && (
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", textAlign: "center", marginBottom: 16 }}>
            Подтверждаем номер…
          </p>
        )}

        {error && (
          <p style={{ color: "var(--tg-theme-destructive-text-color, #c00)", fontSize: 14, marginBottom: 16 }}>
            {error}
          </p>
        )}

        {!window.Telegram?.WebApp?.MainButton && (
          <button
            type="button"
            className="primary"
            onClick={handleRequestContact}
            disabled={loading}
            style={{ marginTop: 16 }}
          >
            Подтвердить номер
          </button>
        )}
      </main>
    </AppRoot>
  );
}
