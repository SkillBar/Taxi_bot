import React from "react";
import ReactDOM from "react-dom/client";
import { initTelegramWebApp } from "./telegramWebApp";
import App from "./App";
import "./index.css";

// Инициализация по гайдлайнам Telegram Mini Apps (ready + expand + тема)
initTelegramWebApp();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
