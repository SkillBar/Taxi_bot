/**
 * Упрощённый главный экран без @telegram-apps/telegram-ui.
 * Показывается при ошибке загрузки или при отключённой TG-теме.
 */
import { useState, useEffect } from "react";
import type { AgentsMe } from "../api";
import { api } from "../lib/api";
import { STAGES, ENDPOINTS, formatStageError, buildErrorMessage } from "../lib/stages";

function displayName(me: AgentsMe | null): string {
  if (!me) return "";
  const first = me.firstName?.trim() || "";
  const last = me.lastName?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || "Пользователь";
}

export interface SimpleHomeScreenProps {
  user: AgentsMe | null;
  onRegisterDriver: () => void;
  onRegisterCourier: () => void;
  onOpenManager?: () => void;
}

export function SimpleHomeScreen({ user, onRegisterDriver, onRegisterCourier, onOpenManager }: SimpleHomeScreenProps) {
  const name = displayName(user);
  const [newPhone, setNewPhone] = useState("");
  const [linking, setLinking] = useState(false);
  const [driversCount, setDriversCount] = useState<number | null>(null);
  const [driversLoadError, setDriversLoadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    setDriversLoadError(null);
    api
      .get<{ drivers: unknown[] }>("/api/manager/drivers")
      .then((r) => {
        setDriversCount(r.data?.drivers?.length ?? 0);
      })
      .catch((e) => {
        setDriversLoadError(formatStageError(STAGES.MANAGER_DRIVERS, ENDPOINTS.MANAGER_DRIVERS, buildErrorMessage(e)));
        setDriversCount(0);
      });
  }, []);

  const handleLinkDriver = async () => {
    const phone = newPhone.trim();
    if (!phone) return;
    setLinkError(null);
    setLinking(true);
    try {
      await api.post("/api/manager/link-driver", { phone });
      setNewPhone("");
      const r = await api.get<{ drivers: unknown[] }>("/api/manager/drivers");
      setDriversCount(r.data?.drivers?.length ?? 0);
      alert("Водитель успешно привязан!");
    } catch (e: unknown) {
      setLinkError(formatStageError(STAGES.LINK_DRIVER, ENDPOINTS.LINK_DRIVER, buildErrorMessage(e)));
    } finally {
      setLinking(false);
    }
  };

  const block = {
    padding: 16,
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    color: "var(--tg-theme-text-color, #000)",
    borderBottom: "1px solid var(--tg-theme-hint-color, #eee)",
  };

  return (
    <div style={{ background: "var(--tg-theme-bg-color, #fff)", color: "var(--tg-theme-text-color, #000)", paddingBottom: 24 }}>
      <div style={block}>
        <p style={{ margin: 0, fontSize: 16 }}>
          {name ? `${name}, добро пожаловать!` : "Добро пожаловать в кабинет агента такси!"}
        </p>
      </div>

      {driversLoadError && (
        <div
          style={{
            ...block,
            border: "1px solid var(--tg-theme-destructive-text-color, #c00)",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 13,
            color: "var(--tg-theme-text-color, #000)",
          }}
        >
          {driversLoadError}
        </div>
      )}

      <div style={block}>
        <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--tg-theme-text-color, #000)" }}>Добавить водителя</p>
        <input
          type="tel"
          placeholder="+7 999 123-45-67"
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            fontSize: 16,
            border: "1px solid var(--tg-theme-hint-color, #ccc)",
            borderRadius: 8,
            marginBottom: 8,
          }}
        />
        <button type="button" className="primary" onClick={handleLinkDriver} disabled={linking} style={{ width: "100%" }}>
          {linking ? "Поиск…" : "Найти и привязать"}
        </button>
        {linkError && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--tg-theme-destructive-text-color, #c00)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {linkError}
          </p>
        )}
        {driversCount != null && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--tg-theme-hint-color, #666)" }}>
            Водителей привязано: {driversCount}
          </p>
        )}
      </div>

      <div style={block}>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--tg-theme-hint-color, #333)" }}>Действия:</p>
        <button type="button" className="primary" onClick={onRegisterDriver} style={{ marginBottom: 8, width: "100%" }}>
          Зарегистрировать водителя
        </button>
        <button type="button" className="secondary" onClick={onRegisterCourier} style={{ marginBottom: 8, width: "100%" }}>
          Регистрация доставка / курьер
        </button>
        {onOpenManager && (
          <button type="button" className="secondary" onClick={onOpenManager} style={{ width: "100%" }}>
            Кабинет менеджера
          </button>
        )}
      </div>
    </div>
  );
}
