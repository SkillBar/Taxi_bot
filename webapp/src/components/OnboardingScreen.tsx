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
    const park = parkId.trim();
    if (!key) {
      setError("Введите API-ключ");
      return;
    }
    if (!park) {
      setError("Введите ID парка");
      return;
    }
    setError(null);
    setLoading(true);
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (mainBtn?.showProgress) mainBtn.showProgress(true);
    try {
      await connectFleet(key, park);
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      mainBtn?.hide();
      onLinked();
    } catch (e: unknown) {
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      const err = e as { response?: { data?: { message?: string; error?: string } } };
      setError(err.response?.data?.message ?? err.response?.data?.error ?? "Ошибка подключения. Проверьте API-ключ и ID парка.");
    } finally {
      setLoading(false);
    }
  }, [apiKey, parkId, onLinked]);

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
              <p style={{ fontSize: 14, color: "var(--tg-theme-button-color)", margin: "0 0 12px", fontWeight: 600 }}>
                Номер подтверждён.
              </p>
            )}
            <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--tg-theme-text-color)" }}>
              Подключите ваш парк Yandex Fleet
            </h1>
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color)", margin: 0 }}>
              Зайдите в кабинет fleet.yandex.ru → Настройки → API → Создайте ключ. Вставьте API-ключ и ID парка ниже.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Input
              header="API-ключ"
              placeholder="Вставьте API-ключ"
              value={apiKey}
              onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              header="ID парка"
              placeholder="28499fad6fb246c6827dcd3452ba1384"
              value={parkId}
              onChange={(e) => setParkId((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          </div>
          {error && (
            <p style={{ color: "var(--tg-theme-destructive-text-color, #c00)", fontSize: 14, marginBottom: 16 }}>
              {error}
            </p>
          )}

          {loading && (
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color)", textAlign: "center" }}>
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
          <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--tg-theme-text-color)" }}>
            Добро пожаловать в кабинет агента такси!
          </h1>
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color)", margin: 0 }}>
            Подтвердите номер телефона, с которого вы зарегистрированы как агент таксопарка.
          </p>
        </div>

        {loading && (
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color)", textAlign: "center", marginBottom: 16 }}>
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
