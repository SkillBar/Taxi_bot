import { useState } from "react";
import { getCurrentDraft, createDraft, type Draft } from "./api";
import { RegistrationFlow } from "./RegistrationFlow";

export default function App() {
  const [screen, setScreen] = useState<"welcome" | "loading" | "resume" | "flow">("welcome");
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
