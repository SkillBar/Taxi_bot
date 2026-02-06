import { useState, useEffect } from "react";
import { getAgentsMe, getCurrentDraft, createDraft, type Draft } from "./api";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { AgentHomeScreen } from "./components/AgentHomeScreen";
import { RegistrationFlow } from "./RegistrationFlow";
import { ManagerDashboard } from "./components/ManagerDashboard";

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

  // При загрузке: если пользователь уже привязан — показываем главный экран, иначе онбординг
  useEffect(() => {
    getAgentsMe()
      .then((me) => {
        setScreen(me.linked ? "home" : "onboarding");
      })
      .catch(() => {
        setScreen("onboarding");
      });
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

  // —— Полный кабинет менеджера (список + добавление водителя) ———
  if (screen === "manager") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--tg-theme-secondary-bg-color, #f5f5f5)" }}>
        <div style={{ padding: 12 }}>
          <button
            type="button"
            className="secondary"
            onClick={() => setScreen("home")}
            style={{ marginBottom: 8 }}
          >
            ← Назад
          </button>
        </div>
        <ManagerDashboard />
      </div>
    );
  }

  // —— Онбординг: подключение по номеру Telegram ———
  if (screen === "onboarding") {
    return <OnboardingScreen onLinked={() => setScreen("home")} />;
  }

  // —— Главный экран: приветствие + исполнители + кнопки ———
  if (screen === "home") {
    return (
      <AgentHomeScreen
        onRegisterDriver={() => startRegistration("driver")}
        onRegisterCourier={() => startRegistration("courier")}
        onOpenManager={() => setScreen("manager")}
      />
    );
  }

  // —— Инициализация или загрузка ———
  if (screen === "init" || screen === "loading") {
    return (
      <div style={{ padding: 20, textAlign: "center", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Загрузка…
      </div>
    );
  }

  // —— Продолжить регистрацию или начать заново ———
  if (screen === "resume" && draft && typeof draft === "object" && "id" in draft) {
    return (
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
    );
  }

  // —— Регистрация (драфт) ———
  if (screen === "flow" && draft && typeof draft === "object" && "id" in draft) {
    return (
      <RegistrationFlow
        draft={draft}
        setDraft={setDraft}
        type={type}
        onClose={() => window.Telegram?.WebApp?.close?.()}
        onSendData={(data) => window.Telegram?.WebApp?.sendData?.(data)}
        onBackToWelcome={backToHome}
      />
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <button type="button" className="secondary" onClick={backToHome}>
        На главную
      </button>
    </div>
  );
}
