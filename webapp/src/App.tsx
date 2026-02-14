import { Component, useState, useEffect } from "react";
import { getAgentsMe, getApiPing, getCurrentDraft, createDraft, type Draft, type AgentsMe } from "./api";
import { getManagerMe } from "./lib/api";
import { STAGES, ENDPOINTS, formatStageError, buildErrorMessage } from "./lib/stages";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { AgentHomeScreen } from "./components/AgentHomeScreen";
import { CabinetScreen } from "./components/CabinetScreen";
import { SimpleHomeScreen } from "./components/SimpleHomeScreen";
import { RegistrationFlow } from "./RegistrationFlow";
import { ManagerDashboard } from "./components/ManagerDashboard";
import { hapticImpact } from "./lib/haptic";

const STORAGE_LINKED_KEY = "agent_linked";

function setLinkedPersist(linked: boolean) {
  try {
    if (linked) localStorage.setItem(STORAGE_LINKED_KEY, "1");
    else localStorage.removeItem(STORAGE_LINKED_KEY);
  } catch {
    // ignore
  }
}

/** Ждём появления initData (Telegram инжектирует его асинхронно). При повторном входе без ожидания запрос уходит без auth и бэкенд возвращает 401 / linked: false. */
function waitForInitData(maxMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const wa = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    if (!wa?.initData || wa.initData.length > 0) {
      resolve();
      return;
    }
    const step = 100;
    let elapsed = 0;
    const t = setInterval(() => {
      elapsed += step;
      if (wa.initData?.length) {
        clearInterval(t);
        resolve();
        return;
      }
      if (elapsed >= maxMs) {
        clearInterval(t);
        resolve();
      }
    }, step);
  });
}

class HomeErrorBoundary extends Component<
  { children: React.ReactNode; onBack: () => void },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false as boolean, error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, minHeight: "100vh", background: "#f5f5f5" }}>
          <p style={{ color: "#000", marginBottom: 12 }}>Произошла ошибка при загрузке.</p>
          <button type="button" className="secondary" onClick={this.props.onBack}>
            На главную
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Ловит падения из-за telegram-ui / темы TG и предлагает открыть кабинет без них */
class UIErrorBoundary extends Component<
  { children: React.ReactNode; onUseSimpleUI: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: "var(--tg-theme-bg-color, #fff)", color: "var(--tg-theme-text-color, #000)" }}>
          <p style={{ marginBottom: 12 }}>Не удалось загрузить интерфейс.</p>
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #666)", marginBottom: 16 }}>
            Откройте кабинет в упрощённом режиме.
          </p>
          <button type="button" className="primary" onClick={this.props.onUseSimpleUI}>
            Открыть кабинет
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type Screen =
  | "init"       // проверка linked
  | "initError"  // сбой на этапе agents/me или manager/me — показываем этап и «Повторить»
  | "onboarding" // подключение по номеру
  | "home"       // приветствие + список исполнителей + кнопки
  | "loading"
  | "resume"
  | "flow"
  | "manager";   // полный кабинет менеджера (список + добавление)

export default function App() {
  const [screen, setScreen] = useState<Screen>("init");
  const [type, setType] = useState<"driver" | "courier">("driver");
  const [draft, setDraft] = useState<Draft | null | "new">(null);
  const [useSimpleUI, setUseSimpleUI] = useState(false);
  const [me, setMe] = useState<AgentsMe | null>(null);
  const [initError, setInitError] = useState<{ stage: string; endpoint: string; message: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [initRetrying, setInitRetrying] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"main" | "cabinet">("main");

  // При загрузке: ждём initData (TG отдаёт его асинхронно), затем agents/me → при linked проверка manager/me. При 401 и wasLinked — повтор до 2 раз (initData мог подтянуться позже).
  useEffect(() => {
    if (screen !== "init") return;
    setInitError(null);
    const wasLinked = typeof window !== "undefined" && localStorage.getItem(STORAGE_LINKED_KEY) === "1";
    if (wasLinked) setScreen("home");

    let retriesLeft = 2;
    function runInit() {
      waitForInitData(3000)
        .then(() => getAgentsMe())
        .then((agentMe) => {
          setMe(agentMe);
          setLinkedPersist(agentMe.linked);
          setScreen((prev) => {
            if (prev !== "init" && prev !== "home") return prev;
            if (!agentMe.linked) return "onboarding";
            return "home";
          });
          if (agentMe.linked) {
            return getManagerMe()
              .then((manager) => {
                setScreen((prev) => (prev === "init" || prev === "home" ? (manager.hasFleet ? "home" : "onboarding") : prev));
              })
              .catch((e) => {
                setInitError({
                  stage: STAGES.MANAGER_ME,
                  endpoint: ENDPOINTS.MANAGER_ME,
                  message: buildErrorMessage(e),
                });
                setScreen((prev) => (prev === "init" || prev === "home" ? "initError" : prev));
              });
          }
        })
        .catch((e) => {
          const status = (e as { status?: number }).status;
          if (status === 401 && wasLinked && retriesLeft > 0) {
            retriesLeft -= 1;
            setTimeout(runInit, 500);
            return;
          }
          setLinkedPersist(false);
          setInitError({
            stage: STAGES.AGENTS_ME,
            endpoint: ENDPOINTS.AGENTS_ME,
            message: buildErrorMessage(e),
          });
          setScreen((prev) => (prev === "init" || prev === "home" ? "initError" : prev));
        })
        .finally(() => setInitRetrying(false));
    }
    runInit();
  }, [retryCount, screen]);

  // Скрыть MainButton на главном экране (на случай перехода с онбординга)
  useEffect(() => {
    if (screen === "home") window.Telegram?.WebApp?.MainButton?.hide();
  }, [screen]);

  // После возврата с Yandex OAuth: очистить URL и показать сообщение
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("yandex_oauth");
    if (oauth === "linked") {
      const u = new URL(window.location.href);
      u.searchParams.delete("yandex_oauth");
      u.searchParams.delete("error");
      window.history.replaceState({}, "", u.pathname + u.search);
      alert("Яндекс подключён");
    } else if (params.get("error")) {
      const u = new URL(window.location.href);
      u.searchParams.delete("yandex_oauth");
      u.searchParams.delete("error");
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  }, []);

  const startRegistration = (selectedType: "driver" | "courier") => {
    setType(selectedType);
    setScreen("loading");
    getCurrentDraft()
      .then((d) => {
        if (d && d.status === "in_progress" && d.type === selectedType) {
          setDraft(d);
          setScreen("resume");
        } else {
          setDraft("new");
          createDraft(selectedType)
            .then((created) => {
              setDraft(created);
              setScreen("flow");
            })
            .catch((e) => {
              alert(e.message ?? "Ошибка создания черновика");
              setScreen("home");
            });
        }
      })
      .catch(() => {
        setDraft("new");
        createDraft(selectedType)
          .then((created) => {
            setDraft(created);
            setScreen("flow");
          })
          .catch((e) => {
            alert(e.message ?? "Ошибка создания черновика");
            setScreen("home");
          });
      });
  };

  const continueRegistration = () => {
    setScreen("flow");
  };

  const startOver = () => {
    setScreen("loading");
    createDraft(type)
      .then((created) => {
        setDraft(created);
        setScreen("flow");
      })
      .catch((e) => {
        alert(e.message ?? "Ошибка");
        setScreen("resume");
      });
  };

  const backToHome = () => {
    setDraft(null);
    setScreen("home");
  };

  // Обёртка: нативная тема Telegram (--tg-theme-*)
  const wrapperStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--tg-theme-bg-color, #ffffff)",
    color: "var(--tg-theme-text-color, #000000)",
  };
  const topBarStyle: React.CSSProperties = {
    padding: "12px 16px",
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    color: "var(--tg-theme-text-color, #000000)",
    borderBottom: "1px solid var(--tg-theme-hint-color, #e0e0e0)",
    fontSize: 16,
    fontWeight: 600,
  };

  const handleUseSimpleUI = () => {
    setUseSimpleUI(true);
    setScreen("home");
  };

  return (
    <div data-app-root style={wrapperStyle}>
      <div style={topBarStyle}>Кабинет агента такси</div>

      <UIErrorBoundary onUseSimpleUI={handleUseSimpleUI}>
        {screen === "manager" && (
          <>
            <div style={{ padding: 12 }}>
              <button type="button" className="secondary" onClick={() => setScreen("home")} style={{ marginBottom: 8 }}>
                ← Назад
              </button>
            </div>
            <ManagerDashboard />
          </>
        )}

        {screen === "onboarding" && !useSimpleUI && (
          <OnboardingScreen
            onLinked={() => {
              setLinkedPersist(true);
              setScreen("home");
            }}
          />
        )}

        {screen === "home" && (
          <>
            <div style={{ paddingBottom: 56, background: "var(--tg-theme-bg-color, #fafafa)", minHeight: "100vh" }}>
              {activeTab === "main" &&
                (useSimpleUI ? (
                  <SimpleHomeScreen
                    user={me}
                    onRegisterDriver={() => startRegistration("driver")}
                    onRegisterCourier={() => startRegistration("courier")}
                    onOpenManager={() => setScreen("manager")}
                  />
                ) : (
                  <HomeErrorBoundary onBack={() => setScreen("init")}>
                    <AgentHomeScreen
                      mainTabOnly
                      onRegisterDriver={() => startRegistration("driver")}
                      onRegisterCourier={() => startRegistration("courier")}
                      onOpenManager={() => setScreen("manager")}
                    />
                  </HomeErrorBoundary>
                ))}
              {activeTab === "cabinet" && (
              <CabinetScreen
                onSupport={() => {
                  const link = (import.meta as { env?: { VITE_SUPPORT_LINK?: string } }).env?.VITE_SUPPORT_LINK || "https://t.me/";
                  if (typeof window.Telegram?.WebApp?.openTelegramLink === "function") {
                    window.Telegram.WebApp.openTelegramLink(link);
                  } else if (typeof window.Telegram?.WebApp?.openLink === "function") {
                    window.Telegram.WebApp.openLink(link);
                  }
                }}
                onLogout={() => {
                  setLinkedPersist(false);
                  if (typeof window.Telegram?.WebApp?.close === "function") {
                    window.Telegram.WebApp.close();
                  } else {
                    setScreen("onboarding");
                  }
                }}
              />
            )}
            </div>
            <div
              style={{
                position: "fixed",
                bottom: 0,
                left: 0,
                right: 0,
                display: "flex",
                background: "#2a2a2e",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
                zIndex: 100,
              }}
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "main"}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  fontSize: 12,
                  fontWeight: activeTab === "main" ? 600 : 400,
                  color: activeTab === "main" ? "var(--tg-theme-button-color, #0a84ff)" : "rgba(255,255,255,0.7)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
                onClick={() => {
                  hapticImpact("light");
                  setActiveTab("main");
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Главная
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "cabinet"}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  fontSize: 12,
                  fontWeight: activeTab === "cabinet" ? 600 : 400,
                  color: activeTab === "cabinet" ? "var(--tg-theme-button-color, #0a84ff)" : "rgba(255,255,255,0.7)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
                onClick={() => {
                  hapticImpact("light");
                  setActiveTab("cabinet");
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Кабинет
              </button>
            </div>
          </>
        )}

      </UIErrorBoundary>

      {screen === "initError" && initError && (
        <div
          style={{
            padding: 20,
            minHeight: "100vh",
            background: "var(--tg-theme-bg-color, #fff)",
            color: "var(--tg-theme-text-color, #000)",
          }}
        >
          <p style={{ fontSize: 13, color: "var(--tg-theme-hint-color, #666)", marginBottom: 16, fontStyle: "italic" }}>
            Ведутся технические работы. Приносим извинения за неудобства.
          </p>
          <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 16 }}>Сбой при загрузке</p>
          <p style={{ fontSize: 14, marginBottom: 4, color: "var(--tg-theme-hint-color, #666)" }}>
            Этап: {initError.stage}
          </p>
          <p style={{ fontSize: 13, marginBottom: 8, color: "var(--tg-theme-hint-color, #666)" }}>
            Запрос: {initError.endpoint}
          </p>
          <div
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
              padding: 12,
              background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
              borderRadius: 8,
              marginBottom: 16,
              border: "1px solid var(--tg-theme-hint-color, #ddd)",
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {initError.message}
          </div>
          <button
            type="button"
            className="primary"
            disabled={initRetrying}
            onClick={() => {
              setInitError(null);
              setInitRetrying(true);
              setScreen("init");
              setRetryCount((c) => c + 1);
            }}
          >
            {initRetrying ? "Повторная попытка…" : "Повторить"}
          </button>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 12 }}
            onClick={() => {
              setPingResult(null);
              getApiPing()
                .then((r) => setPingResult(`Ping OK. Origin: ${r.origin ?? "(нет)"}, url: ${r.url ?? "-"}`))
                .catch((e) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  const hint = msg.includes("404") ? " Передеплойте API на Vercel (проект taxi-botapi)." : "";
                  setPingResult(`Ping ошибка: ${msg}.${hint}`);
                });
            }}
          >
            Проверить связь (ping)
          </button>
          {pingResult != null && (
            <p style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{pingResult}</p>
          )}
        </div>
      )}

      {(screen === "init" || screen === "loading") && (
        <div style={{ padding: 20, textAlign: "center", background: "var(--tg-theme-bg-color, #fff)", color: "var(--tg-theme-text-color, #000)" }}>
          {initRetrying ? "Повторная попытка…" : "Загрузка…"}
        </div>
      )}

      {screen === "resume" && draft && typeof draft === "object" && "id" in draft && (
        <div style={{ padding: 20 }}>
          <p>Продолжить регистрацию или начать заново?</p>
          <button type="button" className="primary" onClick={continueRegistration}>
            Продолжить регистрацию
          </button>
          <button type="button" className="secondary" onClick={startOver}>
            Начать заново
          </button>
          <button type="button" className="secondary" onClick={backToHome} style={{ marginTop: 8 }}>
            На главную
          </button>
        </div>
      )}

      {screen === "flow" && draft && typeof draft === "object" && "id" in draft && (
        <RegistrationFlow
          draft={draft}
          setDraft={setDraft}
          type={type}
          onClose={() => window.Telegram?.WebApp?.close?.()}
          onSendData={(data) => window.Telegram?.WebApp?.sendData?.(data)}
          onBackToWelcome={backToHome}
        />
      )}

      {screen !== "manager" &&
        screen !== "onboarding" &&
        screen !== "home" &&
        screen !== "init" &&
        screen !== "loading" &&
        screen !== "resume" &&
        screen !== "flow" && (
          <div style={{ padding: 20 }}>
            <button type="button" className="secondary" onClick={backToHome}>
              На главную
            </button>
          </div>
        )}
    </div>
  );
}
