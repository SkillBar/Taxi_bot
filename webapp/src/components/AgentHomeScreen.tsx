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
import { api, getYandexOAuthAuthorizeUrl } from "../lib/api";
import { getAgentsMe, type AgentsMe } from "../api";
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
}

export function AgentHomeScreen({ onRegisterDriver, onRegisterCourier, onOpenManager }: AgentHomeScreenProps) {
  const [user, setUser] = useState<AgentsMe | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [linking, setLinking] = useState(false);
  const [yandexOAuthLoading, setYandexOAuthLoading] = useState(false);
  const [yandexOAuthError, setYandexOAuthError] = useState<string | null>(null);

  useEffect(() => {
    getAgentsMe()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const fetchDrivers = async () => {
    setDriversLoading(true);
    try {
      const res = await api.get<{ drivers: Driver[] }>("/api/manager/drivers");
      setDrivers(res.data.drivers ?? []);
    } catch {
      setDrivers([]);
    } finally {
      setDriversLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers();
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
    setLinking(true);
    try {
      await api.post("/api/manager/link-driver", { phone });
      setNewPhone("");
      await fetchDrivers();
      alert("Водитель успешно привязан!");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; error?: string } } };
      alert(err.response?.data?.message ?? err.response?.data?.error ?? "Ошибка привязки. Проверьте номер.");
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
          minHeight: "100vh",
          background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
          paddingBottom: 24,
        }}
      >
        <div style={{ padding: "20px 16px 16px" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 4px", color: "var(--tg-theme-text-color)" }}>
            {name ? `${name}, добро пожаловать в кабинет агента такси!` : "Добро пожаловать в кабинет агента такси!"}
          </h1>
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color)", margin: 0 }}>Далее</p>
        </div>

        <List>
          <Section header="Исполнители">
            {driversLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Spinner size="l" />
              </div>
            ) : drivers.length === 0 ? (
              <Placeholder header="Исполнители не найдены" description="Добавьте водителя ниже или обратитесь к администратору" />
            ) : (
              drivers.map((driver) => (
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
                    <span style={{ fontSize: 12, color: "var(--tg-theme-hint-color)" }}>
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

          <Section>
            <div style={{ padding: "8px 16px 16px" }}>
              <Button size="l" stretched onClick={onRegisterDriver} style={{ marginBottom: 8 }}>
                Зарегистрировать водителя
              </Button>
              <Button size="l" stretched mode="secondary" onClick={onRegisterCourier} style={{ marginBottom: 8 }}>
                Регистрация доставка / курьер
              </Button>
              {onOpenManager && (
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
