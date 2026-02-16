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
import { api, getManagerMe, getYandexOAuthAuthorizeUrl, getFleetList, getDriver, getDriverBalance, getDriverWorkRules, updateDriver, type FleetListOption, type FullDriver, type DriverWorkRule } from "../lib/api";
import { hapticImpact } from "../lib/haptic";
import { getAgentsMe, type AgentsMe } from "../api";
import { STAGES, ENDPOINTS, formatStageError, buildErrorMessage } from "../lib/stages";
import type { Driver } from "./ManagerDashboard";

/** Telegram WebApp: user из initDataUnsafe (доступен при запуске из Telegram). */
function getTelegramWebAppUser(): { id: number; first_name?: string; last_name?: string } | null {
  const u = typeof window !== "undefined" ? window.Telegram?.WebApp?.initDataUnsafe?.user : undefined;
  if (!u || typeof (u as { id?: unknown }).id !== "number") return null;
  const user = u as { id: number; first_name?: string; last_name?: string };
  return { id: user.id, first_name: user.first_name, last_name: user.last_name };
}

/** Водитель "на линии": work_status === "working" и current_status в online/busy/driving. Без current_status считаем не на линии. */
const ON_LINE_CURRENT_STATUSES = ["online", "busy", "driving"] as const;

export type DriverWithOptionalFields = Driver & {
  current_status?: string;
  comment?: string;
};

function isOnLine(d: DriverWithOptionalFields): boolean {
  const work = (d.workStatus ?? "").toLowerCase();
  if (work === "fired") return false;
  if (work !== "working") return false;
  const current = (d.current_status ?? "offline").toLowerCase();
  return ON_LINE_CURRENT_STATUSES.includes(current as (typeof ON_LINE_CURRENT_STATUSES)[number]);
}

function driverDisplayStatus(d: DriverWithOptionalFields): { label: string; color: string; icon: string } {
  const work = (d.workStatus ?? "").toLowerCase();
  if (work === "fired") return { label: "Уволен", color: "#ef4444", icon: "✕" };
  const isWorking = work === "working";
  const current = (d.current_status ?? "offline").toLowerCase();
  if (!isWorking) return { label: "Отдыхает", color: "#6b7280", icon: "○" };
  if (current === "busy") return { label: "Занят", color: "#f59e0b", icon: "●" };
  if (current === "driving") return { label: "На заказе", color: "#3b82f6", icon: "●" };
  if (current === "online") return { label: "На линии", color: "#22c55e", icon: "●" };
  return { label: "Отдыхает", color: "#6b7280", icon: "○" };
}

function displayName(me: AgentsMe | null): string {
  if (!me) return "";
  const first = me.firstName?.trim() || "";
  const last = me.lastName?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || "Пользователь";
}

/** Имя пользователя: сначала из Telegram.WebApp.initDataUnsafe.user, иначе из API (AgentsMe). */
function displayNameFromTelegramOrApi(telegramUser: { first_name?: string; last_name?: string } | null, apiUser: AgentsMe | null): string {
  if (telegramUser) {
    const first = (telegramUser.first_name ?? "").trim();
    const last = (telegramUser.last_name ?? "").trim();
    const name = [first, last].filter(Boolean).join(" ");
    if (name) return name;
  }
  return displayName(apiUser);
}

/** Парсинг ФИО: "Иванов Иван Иванович" → first_name, last_name, middle_name. */
function parseDriverName(fullName: string | null | undefined): { first_name: string; last_name: string; middle_name: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "", middle_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "", middle_name: "" };
  if (parts.length === 2) return { first_name: parts[1], last_name: parts[0], middle_name: "" };
  return {
    first_name: parts[1],
    last_name: parts[0],
    middle_name: parts.slice(2).join(" "),
  };
}

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10 && (digits.startsWith("8") || digits.startsWith("7"))) return "+7" + digits.slice(-10);
  if (digits.length >= 10) return "+" + digits;
  return phone.trim() || "";
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

  const [driverForm, setDriverForm] = useState<{
    first_name: string;
    last_name: string;
    middle_name: string;
    phone: string;
    driver_experience: string;
    driver_license_series_number: string;
    driver_license_country: string;
    driver_license_issue_date: string;
    driver_license_expiration_date: string;
    car_brand: string;
    car_model: string;
    car_color: string;
    car_year: string;
    car_number: string;
    car_registration_certificate_number: string;
    car_id?: string;
  }>({
    first_name: "", last_name: "", middle_name: "", phone: "",
    driver_experience: "", driver_license_series_number: "", driver_license_country: "", driver_license_issue_date: "", driver_license_expiration_date: "",
    car_brand: "", car_model: "", car_color: "", car_year: "", car_number: "", car_registration_certificate_number: "", car_id: undefined,
  });
  const [fleetCountries, setFleetCountries] = useState<FleetListOption[]>([]);
  const [fleetCarBrands, setFleetCarBrands] = useState<FleetListOption[]>([]);
  const [fleetCarModels, setFleetCarModels] = useState<FleetListOption[]>([]);
  const [fleetColors, setFleetColors] = useState<FleetListOption[]>([]);
  const [fleetListsLoading, setFleetListsLoading] = useState(false);
  const [fleetModelsLoading, setFleetModelsLoading] = useState(false);
  const [fleetListsError, setFleetListsError] = useState<string | null>(null);
  const [driverSaveLoading, setDriverSaveLoading] = useState(false);
  const [driverSaveError, setDriverSaveError] = useState<string | null>(null);
  const [driverFormErrors, setDriverFormErrors] = useState<Record<string, string>>({});
  const [driverCardLoading, setDriverCardLoading] = useState(false);
  const [fullDriver, setFullDriver] = useState<FullDriver | null>(null);
  const [driverCardProfile, setDriverCardProfile] = useState<{ balance?: number; blocked_balance?: number; photo_url?: string | null; comment?: string | null } | null>(null);
  const [driverWorkRules, setDriverWorkRules] = useState<DriverWorkRule[]>([]);

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

  /** Поддержка тёмной/светлой темы: прокидываем themeParams в WebApp (header/background). */
  useEffect(() => {
    const wa = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    if (!wa) return;
    const bg = wa.themeParams?.bg_color;
    if (bg && wa.setHeaderColor) wa.setHeaderColor(bg);
    if (bg && wa.setBackgroundColor) wa.setBackgroundColor(bg);
  }, []);

  useEffect(() => {
    if (!selectedDriver) {
      setFullDriver(null);
      setDriverCardProfile(null);
      setDriverWorkRules([]);
      return;
    }
    const parsed = parseDriverName(selectedDriver.name);
    setDriverForm((prev) => ({
      ...prev,
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      middle_name: selectedDriver.middle_name ?? parsed.middle_name ?? "",
      phone: selectedDriver.phone ?? "",
      car_id: (selectedDriver as { car_id?: string | null }).car_id ?? undefined,
    }));
    setFullDriver(null);
    setDriverCardProfile(null);
    setDriverWorkRules([]);
    setDriverSaveError(null);
    setDriverFormErrors({});
    setDriverCardLoading(true);
    Promise.all([
      getDriver(selectedDriver.id),
      getDriverBalance(selectedDriver.id),
      getDriverWorkRules(),
    ])
      .then(([driverRes, balance, rules]) => {
        const full = driverRes.driver;
        setFullDriver(full);
        setDriverForm((prev) => ({
          ...prev,
          first_name: full.first_name ?? prev.first_name,
          last_name: full.last_name ?? prev.last_name,
          middle_name: full.middle_name ?? prev.middle_name,
          phone: full.phone ?? prev.phone,
          driver_license_series_number: full.driver_license?.series_number ?? prev.driver_license_series_number,
          driver_license_country: full.driver_license?.country ?? prev.driver_license_country,
          driver_license_issue_date: full.driver_license?.issue_date?.slice(0, 10) ?? prev.driver_license_issue_date,
          driver_license_expiration_date: full.driver_license?.expiration_date?.slice(0, 10) ?? prev.driver_license_expiration_date,
          driver_experience: full.driver_experience != null ? String(full.driver_experience) : prev.driver_experience,
          car_id: full.car_id ?? full.car?.id ?? prev.car_id,
          car_brand: full.car?.brand ?? prev.car_brand,
          car_model: full.car?.model ?? prev.car_model,
          car_color: full.car?.color ?? prev.car_color,
          car_year: full.car?.year != null ? String(full.car.year) : prev.car_year,
          car_number: full.car?.number ?? prev.car_number,
          car_registration_certificate_number: full.car?.registration_certificate_number ?? prev.car_registration_certificate_number,
        }));
        const balanceVal = balance?.balance ?? full.balance;
        setDriverCardProfile({
          balance: balanceVal,
          blocked_balance: balance?.blocked_balance,
          photo_url: full.photo_url,
          comment: full.comment,
        });
        setDriverWorkRules(Array.isArray(rules) ? rules : []);
      })
      .catch(() => {})
      .finally(() => setDriverCardLoading(false));
    setFleetListsError(null);
    setFleetListsLoading(true);
    Promise.all([
      getFleetList("countries"),
      getFleetList("car-brands"),
      getFleetList("colors"),
    ])
      .then(([countries, brands, colors]) => {
        setFleetCountries(Array.isArray(countries) ? countries : []);
        setFleetCarBrands(Array.isArray(brands) ? brands : []);
        setFleetColors(Array.isArray(colors) ? colors : []);
      })
      .catch((err) => {
        setFleetCountries([]);
        setFleetCarBrands([]);
        setFleetColors([]);
        setFleetListsError("Не удалось загрузить справочники");
        const msg = err?.response?.data?.message ?? err?.message ?? "Не удалось загрузить справочники";
        if (typeof window !== "undefined" && window.Telegram?.WebApp?.showPopup) {
          window.Telegram.WebApp.showPopup({ title: "Ошибка", message: msg });
        } else {
          alert(msg);
        }
      })
      .finally(() => setFleetListsLoading(false));
    setFleetCarModels([]);
  }, [selectedDriver?.id]);

  useEffect(() => {
    if (!selectedDriver || !driverForm.car_brand) {
      setFleetCarModels([]);
      setFleetModelsLoading(false);
      return;
    }
    setFleetModelsLoading(true);
    getFleetList("car-models", { brand: driverForm.car_brand })
      .then((models) => setFleetCarModels(Array.isArray(models) ? models : []))
      .catch(() => setFleetCarModels([]))
      .finally(() => setFleetModelsLoading(false));
  }, [selectedDriver?.id, driverForm.car_brand]);

  const validateDriverForm = useCallback((): Record<string, string> => {
    const err: Record<string, string> = {};
    if (!driverForm.first_name?.trim()) err.first_name = "Введите имя";
    if (!driverForm.last_name?.trim()) err.last_name = "Введите фамилию";
    const phoneNorm = driverForm.phone.trim().replace(/\D/g, "");
    const phoneOk = phoneNorm.length === 11 && (phoneNorm.startsWith("7") || phoneNorm.startsWith("8"));
    if (driverForm.phone.trim() && !phoneOk) err.phone = "Номер: +7 или 8 и 11 цифр";
    const expNum = parseInt(driverForm.driver_experience, 10);
    if (driverForm.driver_experience.trim() && (Number.isNaN(expNum) || expNum < 3)) err.driver_experience = "Стаж не менее 3 лет";
    const issue = driverForm.driver_license_issue_date;
    const expir = driverForm.driver_license_expiration_date;
    if (issue && expir && issue >= expir) err.driver_license_expiration_date = "Дата окончания должна быть позже даты выдачи";
    const yearNum = driverForm.car_year ? parseInt(driverForm.car_year, 10) : NaN;
    if (!Number.isNaN(yearNum) && (yearNum < 1990 || yearNum > 2030)) err.car_year = "Год от 1990 до 2030";
    return err;
  }, [driverForm]);

  const handleDriverSave = useCallback(async () => {
    if (!selectedDriver) return;
    const errors = validateDriverForm();
    if (Object.keys(errors).length > 0) {
      setDriverFormErrors(errors);
      return;
    }
    setDriverFormErrors({});
    setDriverSaveError(null);
    setDriverSaveLoading(true);
    const expNum = parseInt(driverForm.driver_experience, 10);
    const yearNum = driverForm.car_year ? parseInt(driverForm.car_year, 10) : undefined;
    try {
      await updateDriver(selectedDriver.id, {
        driver_profile: {
          first_name: driverForm.first_name.trim() || undefined,
          last_name: driverForm.last_name.trim() || undefined,
          middle_name: driverForm.middle_name.trim() || undefined,
          phones: driverForm.phone.trim() ? [toE164(driverForm.phone)] : undefined,
          driver_experience: Number.isFinite(expNum) && expNum >= 3 ? expNum : undefined,
          driver_license: {
            series_number: driverForm.driver_license_series_number.trim() || undefined,
            country: driverForm.driver_license_country || undefined,
            issue_date: driverForm.driver_license_issue_date || undefined,
            expiration_date: driverForm.driver_license_expiration_date || undefined,
          },
        },
        ...(driverForm.car_id && (driverForm.car_brand || driverForm.car_model || driverForm.car_color || driverForm.car_number || driverForm.car_registration_certificate_number) && {
          car_id: driverForm.car_id,
          car: {
            brand: driverForm.car_brand || undefined,
            model: driverForm.car_model || undefined,
            color: driverForm.car_color || undefined,
            year: yearNum,
            number: driverForm.car_number.trim() || undefined,
            registration_certificate_number: driverForm.car_registration_certificate_number.trim() || undefined,
          },
        }),
      });
      hapticImpact("light");
      setSelectedDriver(null);
      fetchDrivers();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; details?: string } } };
      setDriverSaveError(err.response?.data?.message ?? err.response?.data?.details ?? buildErrorMessage(e));
    } finally {
      setDriverSaveLoading(false);
    }
  }, [selectedDriver, driverForm, fetchDrivers, validateDriverForm]);

  /** Все активные водители (кроме уволенных) — показываем всех со статусом На линии / Занят / На заказе / Отдыхает. */
  const activeDrivers = useMemo(() => {
    return drivers.filter((d) => d?.id && (d.workStatus ?? "").toLowerCase() !== "fired");
  }, [drivers]);

  /** Приоритет статуса для сортировки: На линии → Занят → На заказе → Отдыхает (не работающие ниже). */
  const statusSortOrder = (d: DriverWithOptionalFields): number => {
    const work = (d.workStatus ?? "").toLowerCase();
    if (work === "fired") return 4;
    if (work !== "working") return 3; // Отдыхает
    const current = (d.current_status ?? "offline").toLowerCase();
    if (current === "online") return 0;
    if (current === "busy") return 1;
    if (current === "driving") return 2;
    return 3;
  };

  const filteredAndSortedDrivers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = q
      ? activeDrivers.filter((d) => {
          const name = (d.name ?? "").toLowerCase();
          return name.includes(q);
        })
      : [...activeDrivers];
    list.sort((a, b) => {
      const orderA = statusSortOrder(a);
      const orderB = statusSortOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      const nameA = (a.name ?? "").trim();
      const nameB = (b.name ?? "").trim();
      return nameA.localeCompare(nameB, "ru");
    });
    return list;
  }, [activeDrivers, searchQuery]);

  /** Telegram WebApp BackButton: show() при открытой карточке, onClick → закрыть модалку (навигация назад). */
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

  /** Telegram WebApp: user_id и имя из initDataUnsafe (поддержка тёмной/светлой темы через themeParams). */
  const telegramWebAppUser = useMemo(() => getTelegramWebAppUser(), []);
  const telegramUserId = telegramWebAppUser?.id ?? null;

  /** Цвета из Telegram.WebApp.themeParams (автоматически тёмная/светлая тема). */
  const themeParams = typeof window !== "undefined" ? window.Telegram?.WebApp?.themeParams : undefined;
  const bgColor = themeParams?.bg_color ?? "var(--tg-theme-bg-color, #ffffff)";
  const textColor = themeParams?.text_color ?? "var(--tg-theme-text-color, #000000)";
  const hintColor = themeParams?.hint_color ?? "var(--tg-theme-hint-color, #999999)";
  const secondaryBgColor = themeParams?.secondary_bg_color ?? "var(--tg-theme-secondary-bg-color, #f5f5f5)";

  /** Pull-to-refresh для списка водителей (custom: без MainButton, жесты на main). */
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

  const name = displayNameFromTelegramOrApi(telegramWebAppUser, user);

  /** Отдельный экран карточки водителя (Telegram UI Kit: List, Section, Input, Button, Cell, Avatar). */
  if (selectedDriver) {
    const status = driverDisplayStatus(selectedDriver);
    const destructiveColor = "var(--tg-theme-destructive-text-color, #ef4444)";
    return (
      <AppRoot>
        <List>
          <Section>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px" }}>
              {driverCardProfile?.photo_url ? (
                <img src={driverCardProfile.photo_url} alt="" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <Avatar size={96} acronym={selectedDriver.name?.[0] ?? selectedDriver.phone?.[0] ?? "?"} />
              )}
              <h2 style={{ margin: "12px 0 4px", fontSize: 20, fontWeight: 600 }}>{selectedDriver.name ?? "Без имени"}</h2>
              <p style={{ margin: 0, fontSize: 14, color: status.color, fontWeight: 500 }}>{status.icon} {status.label}</p>
              {(driverCardProfile?.balance != null || driverCardLoading) && (
                <div style={{ marginTop: 8, textAlign: "center" }}>
                  <p style={{ margin: 0, fontSize: 12, color: hintColor }}>Баланс</p>
                  {driverCardLoading ? (
                    <Spinner size="s" style={{ marginTop: 4 }} />
                  ) : (
                    <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 600, color: (driverCardProfile?.balance ?? 0) >= 0 ? "#22c55e" : destructiveColor }}>
                      {(driverCardProfile?.balance ?? 0) >= 0 ? "" : "−"} {Math.abs(driverCardProfile?.balance ?? 0).toFixed(2)} ₽
                    </p>
                  )}
                  {!driverCardLoading && driverCardProfile?.blocked_balance != null && driverCardProfile.blocked_balance !== 0 && (
                    <p style={{ margin: "2px 0 0", fontSize: 13, color: hintColor }}>
                      Заблокировано: {driverCardProfile.blocked_balance >= 0 ? "" : "−"} {Math.abs(driverCardProfile.blocked_balance).toFixed(2)} ₽
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>

          {fleetListsError && (
            <Section>
              <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--tg-theme-destructive-text-color, #ef4444)" }}>
                {fleetListsError}
              </div>
            </Section>
          )}
          <Section header="Данные водителя">
            <Input header="Имя" placeholder="Имя" value={driverForm.first_name} onChange={(e) => setDriverForm((f) => ({ ...f, first_name: (e.target as HTMLInputElement).value }))} />
            {driverFormErrors.first_name && <p style={{ margin: "4px 16px 0", fontSize: 12, color: destructiveColor }}>{driverFormErrors.first_name}</p>}
            <Input header="Фамилия" placeholder="Фамилия" value={driverForm.last_name} onChange={(e) => setDriverForm((f) => ({ ...f, last_name: (e.target as HTMLInputElement).value }))} />
            {driverFormErrors.last_name && <p style={{ margin: "4px 16px 0", fontSize: 12, color: destructiveColor }}>{driverFormErrors.last_name}</p>}
            <Input header="Отчество" placeholder="Отчество" value={driverForm.middle_name} onChange={(e) => setDriverForm((f) => ({ ...f, middle_name: (e.target as HTMLInputElement).value }))} />
            <Input header="Номер телефона" placeholder="+7 999 123-45-67" type="tel" value={driverForm.phone} onChange={(e) => setDriverForm((f) => ({ ...f, phone: (e.target as HTMLInputElement).value }))} />
            {driverFormErrors.phone && <p style={{ margin: "4px 16px 0", fontSize: 12, color: destructiveColor }}>{driverFormErrors.phone}</p>}
            <Input header="Водительский стаж (лет, мин. 3)" placeholder="3" type="number" value={driverForm.driver_experience} onChange={(e) => setDriverForm((f) => ({ ...f, driver_experience: (e.target as HTMLInputElement).value }))} />
            {driverFormErrors.driver_experience && <p style={{ margin: "4px 16px 0", fontSize: 12, color: destructiveColor }}>{driverFormErrors.driver_experience}</p>}
            <Input header="Серия и номер ВУ" placeholder="1234 567890" value={driverForm.driver_license_series_number} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_series_number: (e.target as HTMLInputElement).value }))} />
            <Cell
              subtitle="Страна выдачи ВУ"
              after={
                <select
                  value={driverForm.driver_license_country}
                  onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_country: e.target.value }))}
                  style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)", border: "none", fontSize: 14 }}
                >
                  <option value="">—</option>
                  {fleetListsLoading && <option disabled>Загрузка...</option>}
                  {!fleetListsLoading && fleetCountries.length === 0 && <option disabled>Нет данных</option>}
                  {fleetCountries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              }
            />
            <Input header="Дата выдачи ВУ" type="date" value={driverForm.driver_license_issue_date} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_issue_date: (e.target as HTMLInputElement).value }))} />
            <Input header="Действует до" type="date" value={driverForm.driver_license_expiration_date} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_expiration_date: (e.target as HTMLInputElement).value }))} />
            {driverFormErrors.driver_license_expiration_date && <p style={{ margin: "4px 16px 0", fontSize: 12, color: destructiveColor }}>{driverFormErrors.driver_license_expiration_date}</p>}
          </Section>

          {driverCardProfile?.comment && (
            <Section header="Комментарий">
              <div style={{ padding: "12px 16px", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {driverCardProfile.comment}
              </div>
            </Section>
          )}

          {driverWorkRules.length > 0 && (
            <Section header="Условия работы">
              {driverWorkRules.map((rule) => (
                <Cell key={rule.id} subtitle={rule.is_enabled ? "Активно" : "Отключено"}>
                  {rule.name}
                </Cell>
              ))}
            </Section>
          )}

          <Section header="Данные автомобиля">
            {fullDriver && !driverForm.car_id && !fullDriver.car?.id ? (
              <Cell subtitle="Нет автомобиля" />
            ) : (
              <>
                <Cell
                  subtitle="Марка"
                  after={
                    <select
                      value={driverForm.car_brand}
                      onChange={(e) => setDriverForm((f) => ({ ...f, car_brand: e.target.value, car_model: "" }))}
                      style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)", border: "none", fontSize: 14 }}
                    >
                      <option value="">—</option>
                      {fleetListsLoading && <option disabled>Загрузка...</option>}
                      {!fleetListsLoading && fleetCarBrands.length === 0 && <option disabled>Нет данных</option>}
                      {fleetCarBrands.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                  }
                />
                <Cell
                  subtitle="Модель"
                  after={
                    <select
                      value={driverForm.car_model}
                      onChange={(e) => setDriverForm((f) => ({ ...f, car_model: e.target.value }))}
                      disabled={!driverForm.car_brand}
                      style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)", border: "none", fontSize: 14 }}
                    >
                      <option value="">—</option>
                      {fleetModelsLoading && <option disabled>Загрузка...</option>}
                      {!fleetModelsLoading && fleetCarModels.length === 0 && driverForm.car_brand && <option disabled>Нет данных</option>}
                      {fleetCarModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  }
                />
                <Cell
                  subtitle="Цвет"
                  after={
                    <select
                      value={driverForm.car_color}
                      onChange={(e) => setDriverForm((f) => ({ ...f, car_color: e.target.value }))}
                      style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)", border: "none", fontSize: 14 }}
                    >
                      <option value="">—</option>
                      {fleetListsLoading && <option disabled>Загрузка...</option>}
                      {!fleetListsLoading && fleetColors.length === 0 && <option disabled>Нет данных</option>}
                      {fleetColors.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  }
                />
                <Input header="Год" placeholder="2020" type="number" value={driverForm.car_year} onChange={(e) => setDriverForm((f) => ({ ...f, car_year: (e.target as HTMLInputElement).value }))} />
                {driverFormErrors.car_year && <p style={{ margin: "4px 16px 0", fontSize: 12, color: destructiveColor }}>{driverFormErrors.car_year}</p>}
                {fullDriver?.car?.transmission && (
                  <Cell subtitle="Коробка передач">
                    {fullDriver.car.transmission === "automatic" ? "Автомат" : fullDriver.car.transmission === "mechanical" ? "Механика" : fullDriver.car.transmission === "robotic" ? "Робот" : fullDriver.car.transmission === "variator" ? "Вариатор" : fullDriver.car.transmission}
                  </Cell>
                )}
                <Input header="Гос. номер" placeholder="А123БВ77" value={driverForm.car_number} onChange={(e) => setDriverForm((f) => ({ ...f, car_number: (e.target as HTMLInputElement).value }))} />
                <Input header="Номер СТС" placeholder="Номер СТС" value={driverForm.car_registration_certificate_number} onChange={(e) => setDriverForm((f) => ({ ...f, car_registration_certificate_number: (e.target as HTMLInputElement).value }))} />
              </>
            )}
          </Section>

          {driverSaveError && (
            <Section>
              <div style={{ padding: "12px 16px", fontSize: 13, color: destructiveColor, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {driverSaveError}
              </div>
            </Section>
          )}

          <Section>
            <div style={{ padding: 16 }}>
              <Button size="l" stretched onClick={handleDriverSave} loading={driverSaveLoading} disabled={driverSaveLoading} style={{ marginBottom: 8 }}>
                Сохранить
              </Button>
              <Button size="l" stretched mode="outline" onClick={() => { hapticImpact("light"); setSelectedDriver(null); }} disabled={driverSaveLoading}>
                Закрыть
              </Button>
            </div>
          </Section>
        </List>
      </AppRoot>
    );
  }

  return (
    <AppRoot>
      <main
        style={{
          minHeight: "60vh",
          background: secondaryBgColor,
          color: textColor,
          paddingBottom: 88,
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
          <Section header="Водители">
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
                  header={activeDrivers.length === 0 ? "Нет водителей" : "Нет совпадений"}
                  description={
                    activeDrivers.length === 0
                      ? "Список водителей пуст или парк не подключён."
                      : "Попробуйте изменить поисковый запрос."
                  }
                />
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
              filteredAndSortedDrivers.map((driver) => {
                const status = driverDisplayStatus(driver);
                return (
                  <Cell
                    key={driver.id}
                    before={<Avatar acronym={driver.name?.[0] ?? "?"} />}
                    description={driver.balance != null ? `${driver.balance} ₽` : undefined}
                    after={
                      <span style={{ fontSize: 12, color: status.color, fontWeight: 500 }}>
                        {status.icon} {status.label}
                      </span>
                    }
                    onClick={() => { hapticImpact("light"); setSelectedDriver(driver); }}
                  >
                    {driver.name ?? "Без имени"}
                  </Cell>
                );
              })
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
                    mode="outline"
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

        </List>

        {/* Кнопка «Добавить водителя» фиксирована внизу над таб-баром */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "12px 16px",
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
            background: bgColor,
            borderTop: `1px solid ${hintColor}`,
          }}
        >
          <Button size="l" stretched onClick={() => { hapticImpact("light"); onRegisterDriver(); }}>
            Добавить водителя
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
      </main>
    </AppRoot>
  );
}
