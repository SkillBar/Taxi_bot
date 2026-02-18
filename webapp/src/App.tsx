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
import { getLinked, getLinkedSync, setLinked } from "./lib/sessionStorage";
import { debugLog } from "./debugLog";

/** Ждём появления initData (Telegram инжектирует асинхронно при открытии/восстановлении). Возвращает true, если initData есть; false при таймауте. */
function waitForInitData(maxMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const wa = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    const hasData = () => Boolean(wa?.initData && String(wa.initData).trim().length > 0);
    if (hasData()) {
      resolve(true);
      return;
    }
    const step = 150;
    let elapsed = 0;
    const t = setInterval(() => {
      elapsed += step;
      if (hasData()) {
        clearInterval(t);
        resolve(true);
        return;
      }
      if (elapsed >= maxMs) {
        clearInterval(t);
        resolve(false);
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
  const [isLightTheme, setIsLightTheme] = useState(false);

  useEffect(() => {
    const scheme = typeof window !== "undefined" ? window.Telegram?.WebApp?.colorScheme : undefined;
    setIsLightTheme(scheme === "light");
  }, []);

  // При загрузке: wasLinked из sessionStorage, ждём initData (при перезаходе TG может подставить его с задержкой), затем agents/me. Без initData не дергаем API — при wasLinked остаёмся на home и повторяем.
  useEffect(() => {
    if (screen !== "init") return;
    // #region debug log
    debugLog({ location: "App.tsx:initEffect", message: "init effect run", data: { screen }, hypothesisId: "H5" });
    // #endregion
    setInitError(null);
    const syncLinked = getLinkedSync();
    if (syncLinked) setScreen("home");

    let retriesLeft = 5;
    let linkedCheckRetries = 2; // при wasLinked и linked:false перепроверить, чтобы не сбросить из-за глитча
    let initDataRetry = false;

    async function runInit() {
      const wasLinked = syncLinked || (await getLinked());
      // #region debug log
      debugLog({ location: "App.tsx:runInit:wasLinked", message: "wasLinked", data: { wasLinked, syncLinked }, hypothesisId: "H1" });
      // #endregion
      if (wasLinked && !syncLinked) setScreen("home");

      const hasInitData = await waitForInitData(initDataRetry ? 2000 : 5000);
      initDataRetry = true;
      // #region debug log
      debugLog({ location: "App.tsx:runInit:hasInitData", message: "waitForInitData done", data: { hasInitData }, hypothesisId: "H2" });
      // #endregion
      if (!hasInitData) {
        if (wasLinked) {
          // #region debug log
          debugLog({ location: "App.tsx:runInit:noInitData", message: "noInitData wasLinked loop", data: { wasLinked }, hypothesisId: "H2" });
          // #endregion
          setTimeout(runInit, 1500);
          return;
        }
        setInitError({
          stage: STAGES.AGENTS_ME,
          endpoint: ENDPOINTS.AGENTS_ME,
          message: "Не получены данные авторизации. Откройте приложение заново из Telegram.",
        });
        setScreen("initError");
        return;
      }

      getAgentsMe()
        .then((agentMe) => {
          setMe(agentMe);
          const willRecheck = !agentMe.linked && wasLinked && linkedCheckRetries > 0;
          // #region debug log
          debugLog({ location: "App.tsx:getAgentsMe:then", message: "getAgentsMe success", data: { linked: agentMe.linked, willRecheck, wasLinked }, hypothesisId: "H3" });
          // #endregion
          if (!willRecheck) {
            if (agentMe.linked || !wasLinked) setLinked(agentMe.linked);
          }
          if (willRecheck) {
            linkedCheckRetries -= 1;
            setTimeout(() => {
              getAgentsMe().then((recheck) => {
                setMe(recheck);
                if (recheck.linked) {
                  setLinked(true);
                  setScreen("home");
                  getManagerMe().catch(() => {});
                } else {
                  if (wasLinked) {
                    setScreen("home");
                  } else {
                    setLinked(false);
                    setScreen((prev) => (prev === "init" || prev === "home" ? "onboarding" : prev));
                  }
                }
              }).catch(() => {});
            }, 600);
            return;
          }
          setScreen((prev) => {
            if (prev !== "init" && prev !== "home") return prev;
            if (!agentMe.linked && !wasLinked) return "onboarding";
            if (!agentMe.linked && wasLinked) return "home";
            return "home";
          });
          if (agentMe.linked) {
            return getManagerMe()
              .then((manager) => {
                setScreen((prev) => (prev === "init" || prev === "home" ? "home" : prev));
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
          // #region debug log
          debugLog({ location: "App.tsx:getAgentsMe:catch", message: "getAgentsMe error", data: { status, wasLinked, retriesLeft }, hypothesisId: "H2" });
          // #endregion
          if (status === 401 && wasLinked && retriesLeft > 0) {
            retriesLeft -= 1;
            setTimeout(runInit, 800);
            return;
          }
          if (status !== 401 && !wasLinked) setLinked(false);
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

  // На главном экране запрещаем скролл страницы — скроллится только блок со списком, низ (кнопка + таб-бар) всегда виден
  useEffect(() => {
    if (screen !== "home") return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.style.height;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.height = "100dvh";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
    };
  }, [screen]);

  const handleDraftError = (e: Error & { agentNotFound?: boolean }) => {
    if (e.agentNotFound) {
      setLinked(false);
      setScreen("onboarding");
      if (typeof window.Telegram?.WebApp?.showAlert === "function") {
        window.Telegram.WebApp.showAlert("Сессия истекла. Пройдите привязку заново.");
      } else {
        alert("Сессия истекла. Пройдите привязку заново.");
      }
      return;
    }
    if (typeof window.Telegram?.WebApp?.showAlert === "function") {
      window.Telegram.WebApp.showAlert(e.message ?? "Ошибка создания черновика");
    } else {
      alert(e.message ?? "Ошибка создания черновика");
    }
    setScreen("home");
  };

  const startRegistration = (selectedType: "driver" | "courier") => {
    setType(selectedType);
    setScreen("loading");
    // Сначала проверяем, что агент привязан — иначе draft API вернёт 404 и покажет «Сессия истекла»
    getAgentsMe()
      .then((agentsMe) => {
        if (!agentsMe?.linked) {
          setLinked(false);
          setScreen("onboarding");
          if (typeof window.Telegram?.WebApp?.showAlert === "function") {
            window.Telegram.WebApp.showAlert("Сначала пройдите привязку номера и подключите парк.");
          } else {
            alert("Сначала пройдите привязку номера и подключите парк.");
          }
          return;
        }
        return getCurrentDraft();
      })
      .then((d) => {
        if (d === undefined) return; // уже ушли на онбординг
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
            .catch(handleDraftError);
        }
      })
      .catch(() => {
        getAgentsMe()
          .then((agentsMe) => {
            if (!agentsMe?.linked) {
              setLinked(false);
              setScreen("onboarding");
              if (typeof window.Telegram?.WebApp?.showAlert === "function") {
                window.Telegram.WebApp.showAlert("Сначала пройдите привязку номера и подключите парк.");
              } else {
                alert("Сначала пройдите привязку номера и подключите парк.");
              }
              return;
            }
            setDraft("new");
            createDraft(selectedType)
              .then((created) => {
                setDraft(created);
                setScreen("flow");
              })
              .catch(handleDraftError);
          })
          .catch(() => {
            setScreen("home");
            if (typeof window.Telegram?.WebApp?.showAlert === "function") {
              window.Telegram.WebApp.showAlert("Не удалось проверить сессию. Проверьте интернет и откройте приложение снова.");
            } else {
              alert("Не удалось проверить сессию. Проверьте интернет и откройте приложение снова.");
            }
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

  // Обёртка: нативная тема Telegram (--tg-theme-*). На главном — фиксированная высота, чтобы низ не уезжал при скролле.
  const wrapperStyle: React.CSSProperties = {
    ...(screen === "home"
      ? { height: "100dvh", minHeight: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }
      : { minHeight: "100vh" }),
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
      {!(screen === "home" && activeTab === "main") && (
        <div style={topBarStyle}>Кабинет агента такси</div>
      )}

      <div style={screen === "home" ? { flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" } : undefined}>
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
              setLinked(true);
              setScreen("home");
            }}
          />
        )}

        {screen === "home" && (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
                overflow: "hidden",
                background: "var(--tg-theme-bg-color, #fafafa)",
              }}
            >
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                }}
              >
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
                        onCredsInvalid={() => setScreen("onboarding")}
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
                      setLinked(false);
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
                  flexShrink: 0,
                  background: "var(--tg-theme-bg-color, #fff)",
                  borderTop: isLightTheme ? "1px solid rgba(0,0,0,0.06)" : "1px solid rgba(255,255,255,0.06)",
                  paddingTop: 12,
                  paddingLeft: 16,
                  paddingRight: 16,
                  paddingBottom: "env(safe-area-inset-bottom, 0px)",
                }}
              >
                {activeTab === "main" && !useSimpleUI && (
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpact("light");
                      startRegistration("driver");
                    }}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      fontSize: 16,
                      fontWeight: 600,
                      color: "#fff",
                      background: "var(--tg-theme-button-color, #2481cc)",
                      border: "none",
                      borderRadius: 12,
                      cursor: "pointer",
                    }}
                  >
                    Добавить водителя
                  </button>
                )}
                <div
                  style={{
                    display: "flex",
                    background: isLightTheme ? "#e5e5ea" : "#2a2a2e",
                    borderTop: isLightTheme ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.06)",
                    marginTop: 8,
                    marginLeft: -16,
                    marginRight: -16,
                    paddingBottom: "env(safe-area-inset-bottom, 0px)",
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
                  color: activeTab === "main" ? "var(--tg-theme-button-color, #0a84ff)" : isLightTheme ? "#6c6c70" : "rgba(255,255,255,0.7)",
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
                  color: activeTab === "cabinet" ? "var(--tg-theme-button-color, #0a84ff)" : isLightTheme ? "#6c6c70" : "rgba(255,255,255,0.7)",
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
              </div>
            </div>
          </>
        )}

        </UIErrorBoundary>
      </div>

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
