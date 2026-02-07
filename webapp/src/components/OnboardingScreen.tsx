import { useEffect, useState, useCallback } from "react";
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

export function OnboardingScreen({ onLinked }: OnboardingScreenProps) {
  const [step, setStep] = useState<Step>("contact");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactSent, setContactSent] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [parkId, setParkId] = useState("");
  const [clientId, setClientId] = useState("");

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
    const key = apiKey.trim();
    if (!key) {
      setError("Введите API-ключ");
      return;
    }
    setError(null);
    setLoading(true);
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (mainBtn?.showProgress) mainBtn.showProgress(true);
    try {
      const res = await connectFleet(key, parkId.trim(), clientId.trim() || undefined);
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      mainBtn?.hide();
      // Запрос прошёл — сразу открываем личный кабинет
      if (res?.success !== false) onLinked();
    } catch (e: unknown) {
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      const err = e as {
        response?: {
          data?: {
            message?: string;
            error?: string;
            code?: string;
            fleetStatus?: number;
          };
        };
      };
      const data = err.response?.data;
      const msg = data?.message ?? data?.error ?? "Ошибка подключения. Проверьте API-ключ и ID парка.";
      const details = data?.details;
      const display = details ? `${msg}\n\nПодробности: ${details}` : msg;
      setError(display);
    } finally {
      setLoading(false);
    }
  }, [apiKey, parkId, clientId, onLinked]);

  useEffect(() => {
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
            {contactSent && (
              <p style={{ fontSize: 14, color: "var(--tg-theme-button-color, #2481cc)", margin: "0 0 12px", fontWeight: 600 }}>
                Номер подтверждён.
              </p>
            )}
            <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--tg-theme-text-color, #000000)" }}>
              Подключите ваш парк Yandex Fleet
            </h1>
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0 }}>
              Введите <strong>API-ключ</strong> из кабинета fleet.yandex.ru → Настройки → API. ID парка определится по ключу или укажите вручную.
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
          <div style={{ marginBottom: 16 }}>
            <Input
              header="ID парка (необязательно)"
              placeholder="Определится по ключу или введите вручную"
              value={parkId}
              onChange={(e) => setParkId((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              header="Client ID (если отличается от дефолтного)"
              placeholder="Оставьте пустым, если не знаете"
              value={clientId}
              onChange={(e) => setClientId((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          </div>
          {error && (
            <div
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

          {!window.Telegram?.WebApp?.MainButton && (
            <button type="button" className="primary" onClick={handleConnectFleet} disabled={loading} style={{ marginTop: 16 }}>
              Подключить
            </button>
          )}
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
