import { AppRoot } from "@telegram-apps/telegram-ui";
import { Button } from "@telegram-apps/telegram-ui";
import { getAgentsMe, type AgentsMe } from "../api";
import { useEffect, useState } from "react";
import { api, getYandexOAuthAuthorizeUrl } from "../lib/api";
import { hapticImpact } from "../lib/haptic";

function displayName(me: AgentsMe | null): string {
  if (!me) return "";
  const first = me.firstName?.trim() || "";
  const last = me.lastName?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || "Пользователь";
}

export interface CabinetScreenProps {
  onOpenManager?: () => void;
  onLogout: () => void;
}

export function CabinetScreen({ onOpenManager, onLogout }: CabinetScreenProps) {
  const [user, setUser] = useState<AgentsMe | null>(null);
  const [yandexLoading, setYandexLoading] = useState(false);
  const [yandexError, setYandexError] = useState<string | null>(null);

  useEffect(() => {
    getAgentsMe()
      .then((me) => setUser(me ?? null))
      .catch(() => setUser(null));
  }, []);

  const handleYandex = async () => {
    hapticImpact("light");
    setYandexError(null);
    setYandexLoading(true);
    try {
      const { url } = await getYandexOAuthAuthorizeUrl();
      if (typeof window.Telegram?.WebApp?.openLink === "function") {
        window.Telegram.WebApp.openLink(url);
      } else {
        window.open(url, "_blank");
      }
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Не удалось получить ссылку";
      setYandexError(msg);
    } finally {
      setYandexLoading(false);
    }
  };

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
          paddingBottom: 120,
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

        <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
          {onOpenManager && (
            <Button size="l" stretched mode="secondary" onClick={() => { hapticImpact("light"); onOpenManager(); }}>
              Кабинет менеджера
            </Button>
          )}
          <Button size="l" stretched mode="secondary" onClick={handleYandex} loading={yandexLoading}>
            Подключить Яндекс Про
          </Button>
          {yandexError && (
            <p style={{ fontSize: 13, color: "var(--tg-theme-destructive-text-color, #c00)", margin: 0 }}>
              {yandexError}
            </p>
          )}
        </div>

        <div
          style={{
            position: "fixed",
            bottom: 56,
            left: 0,
            right: 0,
            padding: "16px 24px",
            background: "var(--tg-theme-bg-color, #fff)",
            borderTop: "1px solid var(--tg-theme-hint-color, #eee)",
          }}
        >
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
