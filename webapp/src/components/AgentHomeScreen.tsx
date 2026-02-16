import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backButton } from "@telegram-apps/sdk-react";
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
import type { Driver } from "./ManagerDashboard";

/** Водитель "на линии": work_status === "working" и (если есть) current_status в online/busy/driving */
const ON_LINE_CURRENT_STATUSES = ["online", "busy", "driving"] as const;

export type DriverWithOptionalFields = Driver & {
  current_status?: { status?: string };
  comment?: string;
};

function isOnLine(d: DriverWithOptionalFields): boolean {
  const work = (d.workStatus ?? "").toLowerCase();
  if (work === "fired") return false;
  if (work !== "working") return false;
  const current = (d as DriverWithOptionalFields).current_status?.status?.toLowerCase();
  if (current != null && current !== "") return ON_LINE_CURRENT_STATUSES.includes(current as (typeof ON_LINE_CURRENT_STATUSES)[number]);
  return true;
}

function driverDisplayStatus(d: DriverWithOptionalFields): { label: string; color: string; icon: string } {
  const work = (d.workStatus ?? "").toLowerCase();
  if (work === "fired") return { label: "Уволен", color: "#ef4444", icon: "✕" };
  const isWorking = work === "working";
  const current = (d as DriverWithOptionalFields).current_status?.status?.toLowerCase();
  const isOffline = current === "offline" || (current != null && current !== "" && !ON_LINE_CURRENT_STATUSES.includes(current as (typeof ON_LINE_CURRENT_STATUSES)[number]));
  if (!isWorking || isOffline) return { label: "Отдыхает", color: "#6b7280", icon: "○" };
  return { label: "На линии", color: "#22c55e", icon: "●" };
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
  mainTabOnly?: boolean;
  onCredsInvalid?: () => void;
}

export function AgentHomeScreen({ onRegisterDriver, onRegisterCourier, onOpenManager, mainTabOnly, onCredsInvalid }: AgentHomeScreenProps) {
  const [user, setUser] = useState<AgentsMe | null>(null);
  const [drivers, setDrivers] = useState<DriverWithOptionalFields[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<DriverWithOptionalFields | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [linking, setLinking] = useState(false);
  const [driversLoadError, setDriversLoadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [yandexOAuthLoading, setYandexOAuthLoading] = useState(false);
  const [yandexOAuthError, setYandexOAuthError] = useState<string | null>(null);
  const [hasFleet, setHasFleet] = useState<boolean | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [pullRefreshY, setPullRefreshY] = useState<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const [driversMeta, setDriversMeta] = useState<{ source?: string; count?: number; hint?: string; rawCount?: number; credsInvalid?: boolean } | null>(null);
  const lastFetchDriversRef = useRef<number>(0);
  const FLEET_DEBOUNCE_MS = 700;

  const fetchDrivers = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchDriversRef.current < FLEET_DEBOUNCE_MS) {
      setDriversLoading(false);
      return;
    }
    lastFetchDriversRef.current = now;
    setDriversLoadError(null);
    setDriversMeta(null);
    setDriversLoading(true);
    try {
      const res = await api.get<{
        drivers?: DriverWithOptionalFields[];
        meta?: { source?: string; count?: number; hint?: string; rawCount?: number; credsInvalid?: boolean };
      }>("/api/manager/drivers");
      const list = res?.data?.drivers;
      setDrivers(Array.isArray(list) ? list : []);
      if (res?.data?.meta) {
        setDriversMeta(res.data.meta);
        if (res.data.meta.credsInvalid) onCredsInvalid?.();
      }
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
  }, [onCredsInvalid]);

  useEffect(() => {
    getAgentsMe()
      .then((me) => setUser(me ?? null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  useEffect(() => {
    getManagerMe()
      .then((data) => {
        setHasFleet(data?.hasFleet ?? false);
        if (data?.welcomeMessage) setWelcomeMessage(data.welcomeMessage);
      })
      .catch(() => setHasFleet(false));
  }, []);

  const onLineDrivers = useMemo(() => {
    return drivers.filter((d) => d?.id && isOnLine(d));
  }, [drivers]);

  const filteredAndSortedDrivers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = q
      ? onLineDrivers.filter((d) => {
          const name = (d.name ?? "").toLowerCase();
          return name.includes(q);
        })
      : [...onLineDrivers];
    list.sort((a, b) => {
      const nameA = (a.name ?? "").trim();
      const nameB = (b.name ?? "").trim();
      return nameA.localeCompare(nameB, "ru");
    });
    return list;
  }, [onLineDrivers, searchQuery]);

  useEffect(() => {
    if (!selectedDriver) {
      try {
        if (backButton?.hide?.isAvailable?.()) backButton.hide();
      } catch {
        /**/
      }
      return;
    }
    try {
      if (backButton?.show?.isAvailable?.()) backButton.show();
      const off = backButton?.onClick?.isAvailable?.() ? backButton.onClick(() => { hapticImpact("light"); setSelectedDriver(null); }) : () => {};
      return () => {
        if (typeof off === "function") off();
        if (backButton?.hide?.isAvailable?.()) backButton.hide();
      };
    } catch {
      return () => {};
    }
  }, [selectedDriver]);

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
      if (typeof window !== "undefined" && window.Telegram?.WebApp?.showPopup) {
        window.Telegram.WebApp.showPopup({ title: "Готово", message: "Водитель успешно привязан." });
      } else {
        alert("Водитель успешно привязан!");
      }
    } catch (e: unknown) {
      setLinkError(formatStageError(STAGES.LINK_DRIVER, ENDPOINTS.LINK_DRIVER, buildErrorMessage(e)));
    } finally {
      setLinking(false);
    }
  };

  const themeParams = typeof window !== "undefined" ? window.Telegram?.WebApp?.themeParams : undefined;
  const bgColor = themeParams?.bg_color ?? "var(--tg-theme-bg-color, #ffffff)";
  const textColor = themeParams?.text_color ?? "var(--tg-theme-text-color, #000000)";
  const hintColor = themeParams?.hint_color ?? "var(--tg-theme-hint-color, #999999)";
  const secondaryBgColor = themeParams?.secondary_bg_color ?? "var(--tg-theme-secondary-bg-color, #f5f5f5)";

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 5) touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return;
    const y = e.touches[0].clientY;
    const delta = y - touchStartY.current;
    if (delta > 60) setPullRefreshY(delta);
  };
  const handleTouchEnd = () => {
    if (pullRefreshY != null && pullRefreshY > 80) fetchDrivers();
    touchStartY.current = null;
    setPullRefreshY(null);
  };

  if (selectedDriver) {
    const status = driverDisplayStatus(selectedDriver);
    return (
      <AppRoot>
        <main
          style={{
            minHeight: "100vh",
            background: secondaryBgColor,
            color: textColor,
            paddingBottom: 24,
          }}
        >
          <div
            style={{
              margin: 16,
              padding: 20,
              background: bgColor,
              borderRadius: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <Avatar size={56} acronym={selectedDriver.name?.[0] ?? selectedDriver.phone?.[0] ?? "?"} />
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: textColor }}>
                  {selectedDriver.name ?? "Без имени"}
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: hintColor }}>
                  {selectedDriver.phone}
                </p>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: hintColor }}>Текущий статус</span>
              <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 500, color: status.color }}>
                <span style={{ marginRight: 6 }}>{status.icon}</span>
                {status.label}
              </p>
            </div>

            {selectedDriver.balance != null && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: hintColor }}>Баланс</span>
                <p style={{ margin: "4px 0 0", fontSize: 15, color: textColor }}>{selectedDriver.balance} ₽</p>
              </div>
            )}

            {selectedDriver.comment && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: hintColor }}>Комментарий</span>
                <p style={{ margin: "4px 0 0", fontSize: 14, color: textColor, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {selectedDriver.comment}
                </p>
              </div>
            )}

            <Button size="l" stretched mode="secondary" onClick={() => { hapticImpact("light"); setSelectedDriver(null); }} style={{ marginTop: 8 }}>
              Закрыть
            </Button>
          </div>
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
          background: secondaryBgColor,
          color: textColor,
          paddingBottom: 24,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {pullRefreshY != null && pullRefreshY > 40 && (
          <div
            style={{
              textAlign: "center",
              padding: 12,
              fontSize: 13,
              color: hintColor,
            }}
          >
            {pullRefreshY > 80 ? "Отпустите для обновления" : "Потяните для обновления"}
          </div>
        )}

        {welcomeMessage && (
          <div
            style={{
              padding: "10px 16px",
              margin: "0 0 8px",
              background: "var(--tg-theme-button-color, #2481cc)",
              color: "#fff",
              fontSize: 13,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>{welcomeMessage}</span>
            <button
              type="button"
              onClick={() => setWelcomeMessage(null)}
              style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", padding: "0 4px", fontSize: 18, lineHeight: 1 }}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        )}

        {!mainTabOnly && (
          <div style={{ padding: "12px 16px", background: secondaryBgColor, color: textColor }}>
            <p style={{ fontSize: 14, color: hintColor, margin: 0 }}>
              {name ? `${name}, добро пожаловать!` : "Добро пожаловать в кабинет агента такси!"}
            </p>
          </div>
        )}

        {driversLoadError && (
          <div
            style={{
              margin: 16,
              padding: 12,
              background: secondaryBgColor,
              borderRadius: 8,
              border: "1px solid var(--tg-theme-destructive-text-color, #ef4444)",
              color: textColor,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
            }}
          >
            {driversLoadError}
          </div>
        )}

        <List>
          <Section
            header={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: "#22c55e", flexShrink: 0 }} />
                На линии
              </span>
            }
          >
            <div style={{ padding: "0 16px 12px" }}>
              <input
                type="text"
                placeholder="Поиск по имени водителя"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  fontSize: 15,
                  border: `1px solid ${hintColor}`,
                  borderRadius: 8,
                  background: bgColor,
                  color: textColor,
                }}
              />
            </div>

            {driversLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Spinner size="l" />
              </div>
            ) : filteredAndSortedDrivers.length === 0 ? (
              <>
                <Placeholder
                  header={onLineDrivers.length === 0 ? "Никого на линии" : "Нет совпадений"}
                  description={
                    onLineDrivers.length === 0
                      ? "Сейчас нет водителей со статусом «На линии». Остальные не отображаются."
                      : "Попробуйте изменить поисковый запрос."
                  }
                />
                {drivers.length > 0 && onLineDrivers.length === 0 && (
                  <div
                    style={{
                      margin: "12px 16px",
                      padding: 12,
                      background: secondaryBgColor,
                      borderRadius: 8,
                      border: `1px solid ${hintColor}`,
                      fontSize: 13,
                      color: textColor,
                    }}
                  >
                    Показаны только водители на линии (work_status: working, статус online/busy/driving).
                  </div>
                )}
                {drivers.length === 0 && (
                  <div
                    style={{
                      margin: "12px 16px",
                      padding: 12,
                      background: secondaryBgColor,
                      borderRadius: 8,
                      border: `1px solid ${hintColor}`,
                      fontSize: 13,
                      color: textColor,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {driversMeta?.hint?.trim() ||
                      (hasFleet === false
                        ? "Парк не подключён. Подключите парк в онбординге."
                        : "Список пуст. Проверьте парк и API-ключ в fleet.yandex.ru.")}
                  </div>
                )}
              </>
            ) : (
              filteredAndSortedDrivers.map((driver) => (
                <Cell
                  key={driver.id}
                  before={<Avatar acronym={driver.name?.[0] ?? driver.phone?.[0] ?? "?"} />}
                  subtitle={driver.phone}
                  description={driver.balance != null ? `${driver.balance} ₽` : undefined}
                  after={
                    <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 500 }}>
                      ● На линии
                    </span>
                  }
                  onClick={() => { hapticImpact("light"); setSelectedDriver(driver); }}
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
                    <p style={{ marginTop: 12, fontSize: 13, color: "var(--tg-theme-destructive-text-color, #ef4444)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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
                    <p style={{ color: "var(--tg-theme-destructive-text-color, #ef4444)", fontSize: 14, marginTop: 8 }}>
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
