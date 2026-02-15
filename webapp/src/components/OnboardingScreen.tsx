import { useEffect, useState, useCallback, useRef } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Input } from "@telegram-apps/telegram-ui";
import { getAgentsMe } from "../api";
import { getManagerMe, connectFleet } from "../lib/api";
import { hapticImpact } from "../lib/haptic";
import { STAGES, ENDPOINTS, formatStageError, buildErrorMessage, noConnectionMessage } from "../lib/stages";

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
  /** ID парка — опционально; если пусто, бэкенд попытается определить по ключу. */
  const [parkIdInput, setParkIdInput] = useState("");
  /** Client ID — опционально; если пусто, бэкенд подставит taxi/park/{parkId}. */
  const [clientIdInput, setClientIdInput] = useState("");
  const errorBlockRef = useRef<HTMLDivElement>(null);

  const handleRequestContact = useCallback(() => {
    hapticImpact("light");
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

  const clientIdTrimmed = clientIdInput.trim();
  const clientIdValid = !clientIdTrimmed || /^taxi\/park\/[0-9a-fA-F-]{20,}$/.test(clientIdTrimmed);

  const handleConnectFleet = useCallback(async () => {
    hapticImpact("light");
    const key = apiKey.trim();
    if (!key) {
      setError("Введите API-ключ");
      setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      return;
    }
    if (!clientIdValid) {
      setError("Client ID должен начинаться с taxi/park/ и заканчиваться ID парка (например taxi/park/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");
      setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      return;
    }
    setError(null);
    setLoading(true);
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (mainBtn?.showProgress) mainBtn.showProgress(true);
    try {
      const res = await connectFleet(key, parkIdInput.trim(), clientIdInput.trim() || undefined);
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      mainBtn?.hide();
      // Запрос прошёл — сразу открываем личный кабинет
      if (res?.success !== false) onLinked();
    } catch (e: unknown) {
      if (mainBtn?.showProgress) mainBtn.showProgress(false);
      const stage = STAGES.CONNECT_FLEET;
      const endpoint = ENDPOINTS.CONNECT_FLEET;
      try {
        const err = e as {
          response?: {
            status?: number;
            data?: {
              message?: string;
              error?: string;
              code?: string;
              fleetStatus?: number;
              fleetHint?: string;
              details?: string;
            };
          };
        };
        const status = err.response?.status;
        const data = err.response?.data;

        if (!err.response) {
          setError(formatStageError(stage, endpoint, noConnectionMessage()));
          setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
          return;
        }

        if (status === 401) {
          const msg =
            data?.message ??
            "Не удалось войти. Откройте мини-приложение именно из Telegram (не в браузере) и попробуйте снова.";
          setError(formatStageError(stage, endpoint, msg));
          setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
          return;
        }

        if (status === 400 && (data?.error === "parkId required" || data?.code === "parkId required")) {
          setError(
            (data?.message ?? "По ключу не удалось определить парк автоматически.") +
              "\n\nВведите ID парка в поле ниже (из кабинета fleet.yandex.ru → Настройки → Общая информация) и нажмите «Подключить» снова."
          );
          setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
          return;
        }
        if (status === 400 && data?.code === "FLEET_VALIDATION_FAILED") {
          const humanMsg = data?.message ?? "Ошибка подключения к парку. Проверьте API-ключ и ID парка.";
          const fleetStatus = data?.fleetStatus;
          const fleetHint = data?.fleetHint;
          const details = data?.details;
          const parts: string[] = [humanMsg];
          if (fleetStatus != null) parts.push(`Код ответа Fleet: HTTP ${fleetStatus}`);
          if (fleetHint) parts.push(`Ответ Яндекс: ${fleetHint}`);
          if (details) parts.push(`Подробности: ${details}`);
          setError(formatStageError(stage, endpoint, parts.join("\n\n")));
          setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
          return;
        }

        const msg = data?.message ?? data?.error ?? "Ошибка подключения. Проверьте API-ключ.";
        const details = data?.details;
        setError(formatStageError(stage, endpoint, details ? `${msg}\n\nПодробности: ${details}` : msg));
        setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
      } catch (inner) {
        const fallbackMsg = inner instanceof Error ? inner.message : String(inner);
        setError(formatStageError(stage, endpoint, `Ошибка: ${fallbackMsg}`));
        setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
      }
    } finally {
      setLoading(false);
    }
  }, [apiKey, parkIdInput, clientIdInput, clientIdValid, onLinked]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("skipContact=1")) {
      setStep("fleet");
      setContactSent(true);
      return;
    }
    setError(null);
    getAgentsMe()
      .then((me) => {
        if (me.linked) {
          getManagerMe()
            .then((m) => {
              if (m.hasFleet) onLinked();
              else setStep("fleet");
            })
            .catch((e) => {
              setError(formatStageError(STAGES.MANAGER_ME, ENDPOINTS.MANAGER_ME, buildErrorMessage(e)));
              setStep("fleet");
            });
        } else {
          setStep("contact");
        }
      })
      .catch((e) => {
        setError(formatStageError(STAGES.AGENTS_ME, ENDPOINTS.AGENTS_ME, buildErrorMessage(e)));
        setStep("contact");
      });
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
              Добро пожаловать в кабинет агента таксопарка!
            </h1>
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0 }}>
              Пожалуйста, введите свой API-ключ
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            {typeof window !== "undefined" && !window.Telegram?.WebApp?.initData ? (
              <>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--tg-theme-text-color, #000)" }}>
                  API-ключ
                </label>
                <input
                  type="text"
                  placeholder="Вставьте API-ключ из кабинета Fleet"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={loading}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    fontSize: 16,
                    border: "1px solid var(--tg-theme-hint-color, #ccc)",
                    borderRadius: 8,
                    background: "var(--tg-theme-bg-color, #fff)",
                    color: "var(--tg-theme-text-color, #000)",
                  }}
                />
              </>
            ) : (
              <Input
                header="API-ключ"
                placeholder="Вставьте API-ключ из кабинета Fleet"
                value={apiKey}
                onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                disabled={loading}
              />
            )}
          </div>
          <div style={{ marginBottom: 16 }}>
            {typeof window !== "undefined" && !window.Telegram?.WebApp?.initData ? (
              <>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--tg-theme-text-color, #000)" }}>
                  ID парка (опционально)
                </label>
                <input
                  type="text"
                  placeholder="Оставьте пустым — парк определится по ключу"
                  value={parkIdInput}
                  onChange={(e) => setParkIdInput(e.target.value)}
                  disabled={loading}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    fontSize: 16,
                    border: "1px solid var(--tg-theme-hint-color, #ccc)",
                    borderRadius: 8,
                    background: "var(--tg-theme-bg-color, #fff)",
                    color: "var(--tg-theme-text-color, #000)",
                  }}
                />
              </>
            ) : (
              <Input
                header="ID парка (опционально)"
                placeholder="Оставьте пустым — парк определится по ключу"
                value={parkIdInput}
                onChange={(e) => setParkIdInput((e.target as HTMLInputElement).value)}
                disabled={loading}
              />
            )}
          </div>
          <div style={{ marginBottom: 16 }}>
            {typeof window !== "undefined" && !window.Telegram?.WebApp?.initData ? (
              <>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--tg-theme-text-color, #000)" }}>
                  Client ID (опционально)
                </label>
                <input
                  type="text"
                  placeholder="По умолчанию: taxi/park/{ID парка}"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  disabled={loading}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    fontSize: 16,
                    border: "1px solid var(--tg-theme-hint-color, #ccc)",
                    borderRadius: 8,
                    background: "var(--tg-theme-bg-color, #fff)",
                    color: "var(--tg-theme-text-color, #000)",
                  }}
                />
                {clientIdInput.trim() && !/^taxi\/park\/[0-9a-fA-F-]{20,}$/.test(clientIdInput.trim()) && (
                  <p style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #666)", margin: "6px 0 0", padding: 0 }}>
                    Обычно выглядит как taxi/park/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                  </p>
                )}
              </>
            ) : (
              <Input
                header="Client ID (опционально)"
                placeholder="По умолчанию: taxi/park/{ID парка}"
                value={clientIdInput}
                onChange={(e) => setClientIdInput((e.target as HTMLInputElement).value)}
                disabled={loading}
              />
            )}
          </div>
          {clientIdInput.trim() && !clientIdValid && (
            <p style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #666)", margin: "-8px 0 12px", padding: 0 }}>
              Обычно выглядит как taxi/park/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            </p>
          )}
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
