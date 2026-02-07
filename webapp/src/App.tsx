import { Component, useState, useEffect } from "react";
import { getAgentsMe, getCurrentDraft, createDraft, type Draft } from "./api";
import { getManagerMe } from "./lib/api";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { AgentHomeScreen } from "./components/AgentHomeScreen";
import { RegistrationFlow } from "./RegistrationFlow";
import { ManagerDashboard } from "./components/ManagerDashboard";

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

type Screen =
  | "init"       // проверка linked
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

  // При загрузке: если привязан как агент и подключён Fleet — главный экран, иначе онбординг. Меняем экран только пока init.
  useEffect(() => {
    getAgentsMe()
      .then((me) => {
        setScreen((prev) => {
          if (prev !== "init") return prev;
          if (!me.linked) return "onboarding";
          return prev;
        });
        if (me.linked) {
          return getManagerMe().then((manager) => {
            setScreen((prev) => (prev === "init" ? (manager.hasFleet ? "home" : "onboarding") : prev));
          });
        }
      })
      .catch(() => {
        setScreen((prev) => (prev === "init" ? "onboarding" : prev));
      });
  }, []);

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

  // Одна обёртка: всегда видимый фон и верхняя полоса, чтобы не было пустого экрана в WebView
  const wrapperStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "#ffffff",
    color: "#000000",
  };
  const topBarStyle: React.CSSProperties = {
    padding: "12px 16px",
    background: "#ffffff",
    color: "#000000",
    borderBottom: "1px solid #e0e0e0",
    fontSize: 16,
    fontWeight: 600,
  };

  return (
    <div style={wrapperStyle}>
      <div style={topBarStyle}>Кабинет агента такси</div>

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

      {screen === "onboarding" && <OnboardingScreen onLinked={() => setScreen("home")} />}

      {screen === "home" && (
        <HomeErrorBoundary onBack={() => setScreen("init")}>
          <AgentHomeScreen
            onRegisterDriver={() => startRegistration("driver")}
            onRegisterCourier={() => startRegistration("courier")}
            onOpenManager={() => setScreen("manager")}
          />
        </HomeErrorBoundary>
      )}

      {(screen === "init" || screen === "loading") && (
        <div style={{ padding: 20, textAlign: "center", background: "#ffffff", color: "#000000" }}>
          Загрузка…
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
