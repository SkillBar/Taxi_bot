import React, { Component } from "react";
import ReactDOM from "react-dom/client";
import { initTelegramWebApp } from "./telegramWebApp";
import App from "./App";
import "./index.css";
import "@telegram-apps/telegram-ui/dist/styles.css";

// Инициализация по гайдлайнам Telegram Mini Apps (ready + expand + тема)
initTelegramWebApp();

class RootErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", padding: 20, background: "#ffffff", color: "#000000" }}>
          <h1 style={{ fontSize: 18 }}>Ошибка загрузки</h1>
          <p>Перезапустите приложение.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
