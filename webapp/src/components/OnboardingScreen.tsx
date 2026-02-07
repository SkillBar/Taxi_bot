import { useEffect, useState, useCallback } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Input, Button } from "@telegram-apps/telegram-ui";
import { getAgentsMe } from "../api";
import { getManagerMe, connectFleet } from "../lib/api";

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

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
  const [apiKey, setApiKey] = useState("");
  const [parkId, setParkId] = useState("");

  const pollUntilLinked = useCallback(() => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const tick = async () => {
      if (Date.now() > deadline) {
        setLoading(false);
        setError("Время ожидания истекло. Закройте и откройте приложение снова.");
        return;
      }
      try {
        const me = await getAgentsMe();
        if (me.linked) {
          setLoading(false);
          const manager = await getManagerMe();
          if (manager.hasFleet) {
            onLinked();
            return;
          }
          setStep("fleet");
          return;
        }
      } catch {
        // ignore
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  }, [onLinked]);

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
        pollUntilLinked();
      } else {
        setLoading(false);
        setError("Нужно поделиться контактом для продолжения.");
      }
    });
  }, [pollUntilLinked]);

  const handleConnectFleet = async () => {
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
    try {
      await connectFleet(key, park);
      onLinked();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; error?: string } } };
      setError(err.response?.data?.message ?? err.response?.data?.error ?? "Ошибка подключения. Проверьте API-ключ и ID парка.");
    } finally {
      setLoading(false);
    }
  };

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

  // ——— Шаг 2: подключение Yandex Fleet ———
  if (step === "fleet") {
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

          <Button size="l" stretched onClick={handleConnectFleet} loading={loading}>
            Подключить
          </Button>
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
