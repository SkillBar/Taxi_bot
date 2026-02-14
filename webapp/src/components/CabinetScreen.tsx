import { AppRoot } from "@telegram-apps/telegram-ui";
import { getAgentsMe, type AgentsMe } from "../api";
import { useEffect, useState } from "react";
import { hapticImpact } from "../lib/haptic";

function displayName(me: AgentsMe | null): string {
  if (!me) return "";
  const first = me.firstName?.trim() || "";
  const last = me.lastName?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || "Пользователь";
}

export interface CabinetScreenProps {
  onSupport: () => void;
  onLogout: () => void;
}

export function CabinetScreen({ onSupport, onLogout }: CabinetScreenProps) {
  const [user, setUser] = useState<AgentsMe | null>(null);

  useEffect(() => {
    getAgentsMe()
      .then((me) => setUser(me ?? null))
      .catch(() => setUser(null));
  }, []);

  const name = displayName(user);
  const photoUrl = typeof window !== "undefined" ? (window.Telegram?.WebApp?.initDataUnsafe as { user?: { photo_url?: string } } | undefined)?.user?.photo_url : undefined;

  return (
    <AppRoot>
      <main
        style={{
          minHeight: "100vh",
          background: "var(--tg-theme-bg-color, #fff)",
          color: "var(--tg-theme-text-color, #000)",
          padding: 24,
          paddingBottom: 80,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              margin: "0 auto 12px",
              background: "var(--tg-theme-secondary-bg-color, #e8e8e8)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {photoUrl ? (
              <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: 36, color: "var(--tg-theme-hint-color, #999)" }}>
                {name ? name[0].toUpperCase() : "?"}
              </span>
            )}
          </div>
          <p
            style={{
              fontSize: 20,
              fontWeight: 600,
              margin: 0,
              color: "var(--tg-theme-text-color, #000)",
            }}
          >
            {name || "Пользователь"}
          </p>
        </div>

        <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
          <button
            type="button"
            className="secondary"
            style={{ width: "100%", padding: "12px 16px" }}
            onClick={() => {
              hapticImpact("light");
              onSupport();
            }}
          >
            Связаться с поддержкой
          </button>
          <button
            type="button"
            className="secondary"
            style={{ width: "100%", padding: "12px 16px", color: "var(--tg-theme-destructive-text-color, #c00)", borderColor: "var(--tg-theme-destructive-text-color, #c00)" }}
            onClick={() => {
              hapticImpact("light");
              onLogout();
            }}
          >
            Выйти
          </button>
        </div>
      </main>
    </AppRoot>
  );
}
