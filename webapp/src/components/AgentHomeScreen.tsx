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
import { api, getManagerMe, getYandexOAuthAuthorizeUrl, getFleetList, updateDriver, type FleetListItem } from "../lib/api";
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
  const [fleetCountries, setFleetCountries] = useState<FleetListItem[]>([]);
  const [fleetCarBrands, setFleetCarBrands] = useState<FleetListItem[]>([]);
  const [fleetCarModels, setFleetCarModels] = useState<FleetListItem[]>([]);
  const [fleetColors, setFleetColors] = useState<FleetListItem[]>([]);
  const [fleetListsLoading, setFleetListsLoading] = useState(false);
  const [driverSaveLoading, setDriverSaveLoading] = useState(false);
  const [driverSaveError, setDriverSaveError] = useState<string | null>(null);
  const [driverFormErrors, setDriverFormErrors] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!selectedDriver) return;
    const parsed = parseDriverName(selectedDriver.name);
    setDriverForm((prev) => ({
      ...prev,
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      middle_name: parsed.middle_name,
      phone: selectedDriver.phone ?? "",
      car_id: (selectedDriver as { car_id?: string | null }).car_id ?? undefined,
    }));
    setDriverSaveError(null);
    setDriverFormErrors({});
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
      .catch(() => {})
      .finally(() => setFleetListsLoading(false));
    setFleetCarModels([]);
  }, [selectedDriver?.id]);

  useEffect(() => {
    if (!selectedDriver || !driverForm.car_brand) {
      setFleetCarModels([]);
      return;
    }
    getFleetList("car-models", { brand: driverForm.car_brand })
      .then((models) => setFleetCarModels(Array.isArray(models) ? models : []))
      .catch(() => setFleetCarModels([]));
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
    const inputStyle = {
      width: "100%" as const,
      boxSizing: "border-box" as const,
      padding: "10px 12px",
      fontSize: 15,
      border: `1px solid ${hintColor}`,
      borderRadius: 8,
      background: bgColor,
      color: textColor,
    };
    const labelStyle = { display: "block" as const, fontSize: 12, color: hintColor, marginBottom: 4 };
    return (
      <AppRoot>
        <main style={{ minHeight: "100vh", background: secondaryBgColor, color: textColor, paddingBottom: 24 }}>
          <div style={{ margin: 16, padding: 20, background: bgColor, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <Avatar size={56} acronym={selectedDriver.name?.[0] ?? selectedDriver.phone?.[0] ?? "?"} />
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: textColor }}>{selectedDriver.name ?? "Без имени"}</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: status.color }}>{status.icon} {status.label}</p>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: textColor }}>Данные водителя</div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Имя</label>
                <input style={{ ...inputStyle, borderColor: driverFormErrors.first_name ? "#ef4444" : hintColor }} value={driverForm.first_name} onChange={(e) => setDriverForm((f) => ({ ...f, first_name: e.target.value }))} placeholder="Имя" />
                {driverFormErrors.first_name && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>{driverFormErrors.first_name}</p>}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Фамилия</label>
                <input style={{ ...inputStyle, borderColor: driverFormErrors.last_name ? "#ef4444" : hintColor }} value={driverForm.last_name} onChange={(e) => setDriverForm((f) => ({ ...f, last_name: e.target.value }))} placeholder="Фамилия" />
                {driverFormErrors.last_name && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>{driverFormErrors.last_name}</p>}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Отчество</label>
                <input style={inputStyle} value={driverForm.middle_name} onChange={(e) => setDriverForm((f) => ({ ...f, middle_name: e.target.value }))} placeholder="Отчество" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Номер телефона (E.164)</label>
                <input style={{ ...inputStyle, borderColor: driverFormErrors.phone ? "#ef4444" : hintColor }} type="tel" value={driverForm.phone} onChange={(e) => setDriverForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+7 999 123-45-67" />
                {driverFormErrors.phone && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>{driverFormErrors.phone}</p>}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Водительский стаж (лет, мин. 3)</label>
                <input style={{ ...inputStyle, borderColor: driverFormErrors.driver_experience ? "#ef4444" : hintColor }} type="number" min={3} value={driverForm.driver_experience} onChange={(e) => setDriverForm((f) => ({ ...f, driver_experience: e.target.value }))} placeholder="3" />
                {driverFormErrors.driver_experience && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>{driverFormErrors.driver_experience}</p>}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Серия и номер ВУ</label>
                <input style={inputStyle} value={driverForm.driver_license_series_number} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_series_number: e.target.value }))} placeholder="1234 567890" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Страна выдачи ВУ</label>
                <select style={inputStyle} value={driverForm.driver_license_country} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_country: e.target.value }))}>
                  <option value="">— Выберите —</option>
                  {fleetListsLoading ? <option>Загрузка…</option> : fleetCountries.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Дата выдачи ВУ (YYYY-MM-DD)</label>
                <input style={inputStyle} type="date" value={driverForm.driver_license_issue_date} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_issue_date: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Действует до (YYYY-MM-DD)</label>
                <input style={{ ...inputStyle, borderColor: driverFormErrors.driver_license_expiration_date ? "#ef4444" : hintColor }} type="date" value={driverForm.driver_license_expiration_date} onChange={(e) => setDriverForm((f) => ({ ...f, driver_license_expiration_date: e.target.value }))} />
                {driverFormErrors.driver_license_expiration_date && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>{driverFormErrors.driver_license_expiration_date}</p>}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: textColor }}>Данные автомобиля</div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Марка</label>
                <select style={inputStyle} value={driverForm.car_brand} onChange={(e) => setDriverForm((f) => ({ ...f, car_brand: e.target.value, car_model: "" }))}>
                  <option value="">— Выберите —</option>
                  {fleetCarBrands.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.id}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Модель</label>
                <select style={inputStyle} value={driverForm.car_model} onChange={(e) => setDriverForm((f) => ({ ...f, car_model: e.target.value }))} disabled={!driverForm.car_brand}>
                  <option value="">— Выберите —</option>
                  {fleetCarModels.map((m) => <option key={m.id} value={m.id}>{m.name ?? m.id}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Цвет</label>
                <select style={inputStyle} value={driverForm.car_color} onChange={(e) => setDriverForm((f) => ({ ...f, car_color: e.target.value }))}>
                  <option value="">— Выберите —</option>
                  {fleetColors.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Год</label>
                <input style={{ ...inputStyle, borderColor: driverFormErrors.car_year ? "#ef4444" : hintColor }} type="number" min={1990} max={2030} value={driverForm.car_year} onChange={(e) => setDriverForm((f) => ({ ...f, car_year: e.target.value }))} placeholder="2020" />
                {driverFormErrors.car_year && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>{driverFormErrors.car_year}</p>}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Гос. номер</label>
                <input style={inputStyle} value={driverForm.car_number} onChange={(e) => setDriverForm((f) => ({ ...f, car_number: e.target.value }))} placeholder="А123БВ77" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Номер СТС</label>
                <input style={inputStyle} value={driverForm.car_registration_certificate_number} onChange={(e) => setDriverForm((f) => ({ ...f, car_registration_certificate_number: e.target.value }))} placeholder="Номер СТС" />
              </div>
            </div>

            {driverSaveError && (
              <div style={{ marginBottom: 12, padding: 10, background: "rgba(239,68,68,0.1)", borderRadius: 8, fontSize: 13, color: "#ef4444" }}>
                {driverSaveError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="l" stretched onClick={handleDriverSave} loading={driverSaveLoading} disabled={driverSaveLoading}>
                Сохранить
              </Button>
              <Button size="l" stretched mode="secondary" onClick={() => { hapticImpact("light"); setSelectedDriver(null); }} disabled={driverSaveLoading}>
                Закрыть
              </Button>
            </div>
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
