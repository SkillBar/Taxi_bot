import React, { Component } from "react";
import ReactDOM from "react-dom/client";
import { init as initSDK, themeParams } from "@telegram-apps/sdk-react";
import { initTelegramWebApp } from "./telegramWebApp";
import App from "./App";
import "./index.css";
import "@telegram-apps/telegram-ui/dist/styles.css";

// 1) Legacy WebApp (ready, expand, header/background colors)
try {
  initTelegramWebApp();
} catch {
  // Вне Telegram или при ошибке
}

// 2) @telegram-apps/sdk: обязательна для telegram-ui (AppRoot, List, Section) — без init() падает с «Не удалось загрузить интерфейс»
try {
  initSDK();
  if (themeParams.mountSync?.isAvailable?.()) themeParams.mountSync();
  if (themeParams.bindCssVars?.isAvailable?.()) themeParams.bindCssVars();
} catch {
  // Вне Telegram: тема не применится, но приложение не упадёт (есть UIErrorBoundary + SimpleHomeScreen)
}

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
