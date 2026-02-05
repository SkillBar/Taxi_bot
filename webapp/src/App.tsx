import { useState } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { getCurrentDraft, createDraft, type Draft } from "./api";
import { RegistrationFlow } from "./RegistrationFlow";
import { ManagerDashboard } from "./components/ManagerDashboard";

export default function App() {
  const [screen, setScreen] = useState<"welcome" | "loading" | "resume" | "flow" | "manager">("welcome");
  const [type, setType] = useState<"driver" | "courier">("driver");
  const [draft, setDraft] = useState<Draft | null | "new">(null);

  // ready() уже вызван в main.tsx при загрузке

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
              setScreen("welcome");
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
            setScreen("welcome");
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

  const backToWelcome = () => {
    setDraft(null);
    setScreen("welcome");
  };

  // ——— Кабинет менеджера (список водителей + привязка) ———
  if (screen === "manager") {
    return (
      <AppRoot>
        <main style={{ minHeight: "100vh", background: "var(--tg-theme-secondary-bg-color, #f5f5f5)" }}>
          <div style={{ paddingBottom: 24 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setScreen("welcome")}
              style={{ margin: 12 }}
            >
              ← Назад
            </button>
            <ManagerDashboard />
          </div>
        </main>
      </AppRoot>
    );
  }

  // ——— Первый экран: лого + выбор типа регистрации ———
  if (screen === "welcome") {
    return (
      <div className="welcome-screen">
        <div className="welcome-logo" aria-hidden>
          Лого
        </div>
        <p className="welcome-info">Регистрация исполнителя</p>
        <button
          type="button"
          className="welcome-btn primary"
          onClick={() => startRegistration("driver")}
        >
          Зарегистрировать водителя
        </button>
        <button
          type="button"
          className="welcome-btn primary"
          onClick={() => startRegistration("courier")}
        >
          Регистрация доставка / курьер
        </button>
        <button
          type="button"
          className="welcome-btn secondary"
          onClick={() => setScreen("manager")}
          style={{ marginTop: 8, background: "transparent", border: "2px solid var(--tg-theme-button-color)" }}
        >
          Кабинет менеджера
        </button>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        Загрузка…
      </div>
    );
  }

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
      </div>
    );
  }

  if (screen === "flow" && draft && typeof draft === "object" && "id" in draft) {
    return (
      <RegistrationFlow
        draft={draft}
        setDraft={setDraft}
        type={type}
        onClose={() => window.Telegram?.WebApp?.close?.()}
        onSendData={(data) => window.Telegram?.WebApp?.sendData?.(data)}
        onBackToWelcome={backToWelcome}
      />
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <button type="button" className="secondary" onClick={backToWelcome}>
        Назад
      </button>
    </div>
  );
}
