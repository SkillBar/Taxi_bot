import { useEffect, useState, useCallback, useRef } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Input } from "@telegram-apps/telegram-ui";
import { getAgentsMe } from "../api";
import { getManagerMe, connectFleet, attachDefaultFleet, registerByPhone } from "../lib/api";
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
  const [phoneInput, setPhoneInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  /** Показывать поле ID парка только после ошибки «parkId required» (редкий fallback). */
  const [showParkIdFallback, setShowParkIdFallback] = useState(false);
  const [parkIdInput, setParkIdInput] = useState("");
  /** Показывать форму API-ключа только если преднастроенный парк не задан (attach-default-fleet вернул 400). */
  const [needApiKeyForm, setNeedApiKeyForm] = useState(false);
  /** Сообщение для администратора: схема БД не обновлена (503 SCHEMA_OUTDATED). Не показываем форму API. */
  const [schemaOutdatedMessage, setSchemaOutdatedMessage] = useState<string | null>(null);
  const attachTriedRef = useRef(false);
  const errorBlockRef = useRef<HTMLDivElement>(null);

  /** После того как бот получил контакт и вызвал set-phone, проверяем /me и при hasFleet открываем кабинет. */
  const checkMeAndEnterCabinet = useCallback(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await delay(500);
    try {
      const me = await getManagerMe();
      if (me?.hasFleet) {
        onLinked();
        return true;
      }
    } catch {
      // ignore
    }
    await delay(1200);
    try {
      const me = await getManagerMe();
      if (me?.hasFleet) {
        onLinked();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [onLinked]);

  const handleConfirmContact = useCallback(async () => {
    hapticImpact("light");
    const phone = phoneInput.trim().replace(/\s/g, "");
    if (phone.length >= 10) {
      setError(null);
      setLoading(true);
      try {
        const res = await registerByPhone(phone);
        setLoading(false);
        if (res?.hasFleet) {
          onLinked();
          return;
        }
        setContactSent(true);
        setStep("fleet");
      } catch (e: unknown) {
        setLoading(false);
        const err = e as { response?: { status?: number; data?: { message?: string; notInBase?: boolean } } };
        if (err.response?.status === 403 && err.response?.data?.notInBase) {
          setError("Вашего номера нет в базе агентов. Обратитесь к администратору для регистрации.");
        } else {
          setError(err.response?.data?.message ?? "Не удалось привязать номер. Попробуйте снова или перейдите к вводу ключа.");
        }
        setTimeout(() => errorBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      }
      return;
    }
    const wa = window.Telegram?.WebApp;
    if (!wa?.requestContact) {
      setError("Введите номер (10+ цифр) или поделитесь контактом в Telegram.");
      return;
    }
    setError(null);
    setLoading(true);
    wa.requestContact(async (sent) => {
      if (sent) {
        // Бот получил контакт и вызовет set-phone; проверяем /me и при успехе — в кабинет в 1 клик
        const entered = await checkMeAndEnterCabinet();
        setLoading(false);
        if (entered) return;
        setContactSent(true);
        setStep("fleet");
        setError("Вашего номера нет в базе агентов. Обратитесь к администратору для регистрации.");
      } else {
        setLoading(false);
        setError("Нужно поделиться контактом или ввести номер вручную.");
      }
    });
  }, [phoneInput, onLinked, checkMeAndEnterCabinet]);

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

  const handleConnectFleet = useCallback(async () => {
    hapticImpact("light");
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
      const parkId = showParkIdFallback ? parkIdInput.trim() : "";
      const res = await connectFleet(key, parkId, undefined);
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
          setShowParkIdFallback(true);
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
  }, [apiKey, parkIdInput, showParkIdFallback, onLinked]);

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
            .catch((e: unknown) => {
              const err = e as { response?: { status?: number; data?: { code?: string; message?: string } } };
              if (err.response?.status === 503 && err.response?.data?.code === "SCHEMA_OUTDATED") {
                setSchemaOutdatedMessage(err.response?.data?.message ?? "База данных не обновлена. Обратитесь к администратору.");
                setError(null);
              } else {
                setError(formatStageError(STAGES.MANAGER_ME, ENDPOINTS.MANAGER_ME, buildErrorMessage(e)));
              }
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
    mainBtn.onClick(handleConfirmContact);
    return () => {
      mainBtn.offClick?.(handleConfirmContact);
      mainBtn.hide();
    };
  }, [step, handleConfirmContact]);

  // Автоматическая привязка преднастроенного парка при переходе на шаг fleet (только номер — ключ не вводится).
  useEffect(() => {
    if (step !== "fleet" || needApiKeyForm || attachTriedRef.current) return;
    attachTriedRef.current = true;
    setLoading(true);
    setError(null);
    attachDefaultFleet()
      .then((res) => {
        if (res?.success) {
          onLinked();
          return;
        }
        setNeedApiKeyForm(true);
      })
      .catch((e: unknown) => {
        const err = e as {
          response?: {
            status?: number;
            data?: { code?: string; message?: string };
          };
        };
        const status = err.response?.status;
        const data = err.response?.data;
        if (status === 503 && data?.code === "SCHEMA_OUTDATED") {
          setSchemaOutdatedMessage(data?.message ?? "База данных не обновлена. Обратитесь к администратору.");
          return;
        }
        if (status === 400) {
          setNeedApiKeyForm(true);
        } else {
          setError(
            formatStageError("attach-default-fleet", "/api/manager/attach-default-fleet", (e instanceof Error ? e.message : String(e)) || "Не удалось подключить парк.")
          );
          setNeedApiKeyForm(true);
        }
      })
      .finally(() => setLoading(false));
  }, [step, needApiKeyForm, onLinked]);

  // MainButton на шаге fleet: только когда нужен ручной ввод API-ключа.
  useEffect(() => {
    if (step !== "fleet" || !needApiKeyForm) return;
    const mainBtn = window.Telegram?.WebApp?.MainButton;
    if (!mainBtn) return;
    mainBtn.setText("Подключить");
    mainBtn.show();
    mainBtn.onClick(handleConnectFleet);
    return () => {
      mainBtn.offClick?.(handleConnectFleet);
      mainBtn.hide();
    };
  }, [step, needApiKeyForm, handleConnectFleet]);

  // ——— Шаг 2: подключение Yandex Fleet (сначала авто-привязка парка из конфига, при 400 — форма API-ключа) ———
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
            {schemaOutdatedMessage ? (
              <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0, whiteSpace: "pre-wrap" }}>
                {schemaOutdatedMessage}
              </p>
            ) : !needApiKeyForm ? (
              <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0 }}>
                Подключаем ваш парк…
              </p>
            ) : (
              <>
                <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666666)", margin: 0 }}>
                  Введите API-ключ от вашего таксопарка (Яндекс Про → Настройки → API-доступ). ID парка подставится автоматически.
                </p>
                {contactSent && (
                  <p style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #888)", margin: "8px 0 0", fontStyle: "italic" }}>
                    Если ваш номер в базе агентов — парк должен подставиться сам. Сейчас на сервере не задан парк по умолчанию; попросите администратора добавить YANDEX_PARK_ID, YANDEX_CLIENT_ID, YANDEX_API_KEY в настройки (Vercel → Environment Variables).
                  </p>
                )}
              </>
            )}
          </div>

          {needApiKeyForm && !schemaOutdatedMessage && (
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
          <p style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #666)", margin: "-8px 0 16px", padding: 0 }}>
            Ключ берётся в Яндекс Про → Настройки → API-доступ. Остальное (парк и client ID) подставится автоматически.
          </p>

          {showParkIdFallback && (
            <div style={{ marginBottom: 16 }}>
              {typeof window !== "undefined" && !window.Telegram?.WebApp?.initData ? (
                <>
                  <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--tg-theme-text-color, #000)" }}>
                    ID парка (вручную)
                  </label>
                  <input
                    type="text"
                    placeholder="Из кабинета fleet.yandex.ru → Настройки → Общая информация"
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
                  header="ID парка (вручную)"
                  placeholder="Из кабинета fleet.yandex.ru → Настройки → Общая информация"
                  value={parkIdInput}
                  onChange={(e) => setParkIdInput((e.target as HTMLInputElement).value)}
                  disabled={loading}
                />
              )}
            </div>
          )}

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
            Введите номер или поделитесь контактом — парк подставится автоматически.
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          {typeof window !== "undefined" && !window.Telegram?.WebApp?.initData ? (
            <>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--tg-theme-text-color, #000)" }}>
                Номер телефона
              </label>
              <input
                type="tel"
                placeholder="89996697111 или +7 999 666 97 11"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
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
              header="Номер телефона"
              placeholder="89996697111 или +7 999 666 97 11"
              value={phoneInput}
              onChange={(e) => setPhoneInput((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          )}
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
