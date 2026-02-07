/**
 * Упрощённый главный экран без @telegram-apps/telegram-ui.
 * Показывается при ошибке загрузки или при отключённой TG-теме.
 */
import type { AgentsMe } from "../api";

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
