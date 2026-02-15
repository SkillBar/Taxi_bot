import { useEffect, useState } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  List,
  Section,
  Cell,
  Avatar,
  Input,
  Button,
  Placeholder,
  Spinner,
} from "@telegram-apps/telegram-ui";
import { api, getManagerMe, getYandexOAuthAuthorizeUrl } from "../lib/api";
import { hapticImpact } from "../lib/haptic";
import { getAgentsMe, type AgentsMe } from "../api";
import { STAGES, ENDPOINTS, formatStageError, buildErrorMessage } from "../lib/stages";
import { DriverDetails } from "./DriverDetails";
import type { Driver } from "./ManagerDashboard";

function statusLabel(workStatus?: string): string {
  const s = workStatus?.toLowerCase();
  if (s === "working" || s === "online" || s === "free") return "На линии";
  if (s === "busy") return "Занят";
  return "Офлайн";
}

function displayName(me: AgentsMe | null): string {
  if (!me) return "";
  const first = me.firstName?.trim() || "";
  const last = me.lastName?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || "Пользователь";
}

export interface AgentHomeScreenProps {
  onRegisterDriver: () => void;
  onRegisterCourier: () => void;
  onOpenManager?: () => void;
  /** Только список исполнителей и кнопки «Добавить водителя» / «Добавить курьера» внизу (для таба «Главная»). */
  mainTabOnly?: boolean;
}

export function AgentHomeScreen({ onRegisterDriver, onRegisterCourier, onOpenManager, mainTabOnly }: AgentHomeScreenProps) {
  const [user, setUser] = useState<AgentsMe | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [linking, setLinking] = useState(false);
  const [driversLoadError, setDriversLoadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [yandexOAuthLoading, setYandexOAuthLoading] = useState(false);
  const [yandexOAuthError, setYandexOAuthError] = useState<string | null>(null);
  const [hasFleet, setHasFleet] = useState<boolean | null>(null);

  useEffect(() => {
    getAgentsMe()
      .then((me) => setUser(me ?? null))
      .catch(() => setUser(null));
  }, []);

  const [driversMeta, setDriversMeta] = useState<{ source?: string; count?: number; hint?: string } | null>(null);

  const fetchDrivers = async () => {
    setDriversLoadError(null);
    setDriversMeta(null);
    setDriversLoading(true);
    try {
      const res = await api.get<{ drivers?: Driver[]; meta?: { source?: string; count?: number; hint?: string } }>("/api/manager/drivers");
      const list = res?.data?.drivers;
      setDrivers(Array.isArray(list) ? list : []);
      if (res?.data?.meta) setDriversMeta(res.data.meta);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { message?: string; code?: string } } };
      const status = err.response?.status;
      const data = err.response?.data;
      const msg = data?.message ?? buildErrorMessage(e);
      const code = data?.code;
      setDriversLoadError(
        formatStageError(STAGES.MANAGER_DRIVERS, ENDPOINTS.MANAGER_DRIVERS, [msg, code ? `Код: ${code}` : "", status ? `HTTP ${status}` : ""].filter(Boolean).join(". "))
      );
      setDrivers([]);
    } finally {
      setDriversLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, []);

  useEffect(() => {
    getManagerMe()
      .then((data) => setHasFleet(data?.hasFleet ?? false))
      .catch(() => setHasFleet(false));
  }, []);

  const handleYandexOAuth = async () => {
    setYandexOAuthError(null);
    setYandexOAuthLoading(true);
    try {
      const { url } = await getYandexOAuthAuthorizeUrl();
      if (typeof window.Telegram?.WebApp?.openLink === "function") {
        window.Telegram.WebApp.openLink(url);
      } else {
        window.open(url, "_blank");
      }
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Не удалось получить ссылку";
      setYandexOAuthError(msg);
    } finally {
      setYandexOAuthLoading(false);
    }
  };

  const handleLinkDriver = async () => {
    const phone = newPhone.trim();
    if (!phone) return;
    setLinkError(null);
    setLinking(true);
    try {
      await api.post("/api/manager/link-driver", { phone });
      setNewPhone("");
      await fetchDrivers();
      alert("Водитель успешно привязан!");
    } catch (e: unknown) {
      setLinkError(formatStageError(STAGES.LINK_DRIVER, ENDPOINTS.LINK_DRIVER, buildErrorMessage(e)));
    } finally {
      setLinking(false);
    }
  };

  if (selectedDriver) {
    return (
      <AppRoot>
        <main style={{ minHeight: "100vh", background: "var(--tg-theme-secondary-bg-color, #f5f5f5)", paddingBottom: 24 }}>
          <div style={{ padding: 12 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setSelectedDriver(null)}
              style={{ marginBottom: 8 }}
            >
              ← Назад
            </button>
          </div>
          <DriverDetails driver={selectedDriver} onBack={() => setSelectedDriver(null)} />
        </main>
      </AppRoot>
    );
  }

  const name = displayName(user);

  return (
    <AppRoot>
      <main
        style={{
          minHeight: "60vh",
          background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
          color: "var(--tg-theme-text-color, #000000)",
          paddingBottom: 24,
        }}
      >
        {!mainTabOnly && (
          <div style={{ padding: "12px 16px", background: "var(--tg-theme-secondary-bg-color, #f5f5f5)", color: "var(--tg-theme-text-color, #000)" }}>
            <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #333)", margin: 0 }}>
              {name ? `${name}, добро пожаловать!` : "Добро пожаловать в кабинет агента такси!"}
            </p>
          </div>
        )}

        {driversLoadError && (
          <div
            style={{
              margin: 16,
              padding: 12,
              background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
              borderRadius: 8,
              border: "1px solid var(--tg-theme-destructive-text-color, #c00)",
              color: "var(--tg-theme-text-color, #000)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
            }}
          >
            {driversLoadError}
          </div>
        )}

        <List>
          <Section header="Исполнители">
            {driversLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Spinner size="l" />
              </div>
            ) : drivers.length === 0 ? (
              <Placeholder
                header="Исполнители не найдены"
                description={
                  driversMeta?.hint ??
                  (hasFleet === false
                    ? "Подключите парк (API-ключ Fleet) в онбординге или в Кабинете, чтобы видеть список водителей парка."
                    : "Добавьте водителя ниже или обратитесь к администратору.")
                }
              />
            ) : (
              drivers.filter((d) => d?.id).map((driver) => (
                <Cell
                  key={driver.id}
                  before={
                    <Avatar acronym={driver.name?.[0] ?? driver.phone?.[0] ?? "?"} />
                  }
                  subtitle={driver.phone}
                  description={
                    driver.balance != null || driver.limit != null
                      ? [driver.balance != null ? `${driver.balance} ₽` : null, driver.limit != null ? `${driver.limit} ₽` : null].filter(Boolean).join(" ")
                      : undefined
                  }
                  after={
                    <span style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #666666)" }}>
                      {statusLabel(driver.workStatus)}
                    </span>
                  }
                  onClick={() => setSelectedDriver(driver)}
                >
                  {driver.name ?? "Без имени"}
                </Cell>
              ))
            )}
          </Section>

          {!mainTabOnly && (
            <>
              <Section header="Добавить водителя">
                <Input
                  header="Номер телефона"
                  placeholder="+7 999 123-45-67"
                  value={newPhone}
                  onChange={(e) => setNewPhone((e.target as HTMLInputElement).value)}
                />
                <div style={{ padding: 16 }}>
                  <Button size="l" stretched onClick={handleLinkDriver} loading={linking}>
                    Найти и привязать
                  </Button>
                  {linkError && (
                    <p style={{ marginTop: 12, fontSize: 13, color: "var(--tg-theme-destructive-text-color, #c00)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {linkError}
                    </p>
                  )}
                </div>
              </Section>

              <Section header="Яндекс">
                <div style={{ padding: "8px 16px 16px" }}>
                  <Button
                    size="l"
                    stretched
                    mode="secondary"
                    onClick={handleYandexOAuth}
                    loading={yandexOAuthLoading}
                    style={{ marginBottom: 8 }}
                  >
                    Подключить Яндекс Про / Войти через Яндекс
                  </Button>
                  {yandexOAuthError && (
                    <p style={{ color: "var(--tg-theme-destructive-text-color, #c00)", fontSize: 14, marginTop: 8 }}>
                      {yandexOAuthError}
                    </p>
                  )}
                </div>
              </Section>
            </>
          )}

          <Section>
            <div style={{ padding: "8px 16px 16px" }}>
              <Button size="l" stretched onClick={() => { hapticImpact("light"); onRegisterDriver(); }} style={{ marginBottom: 8 }}>
                Добавить водителя
              </Button>
              <Button size="l" stretched mode="secondary" onClick={() => { hapticImpact("light"); onRegisterCourier(); }} style={{ marginBottom: 8 }}>
                Добавить курьера
              </Button>
              {!mainTabOnly && onOpenManager && (
                <button
                  type="button"
                  className="secondary"
                  onClick={onOpenManager}
                  style={{ width: "100%", marginTop: 8 }}
                >
                  Кабинет менеджера
                </button>
              )}
            </div>
          </Section>
        </List>
      </main>
    </AppRoot>
  );
}
