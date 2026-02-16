import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { STAGES, ENDPOINTS, formatStageError, buildErrorMessage } from "../lib/stages";
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
import { DriverDetails } from "./DriverDetails";

export interface Driver {
  id: string;
  yandexDriverId: string;
  name: string | null;
  phone: string;
  balance?: number;
  workStatus?: string;
  limit?: number;
  car_id?: string | null;
}

export function ManagerDashboard() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  const fetchDrivers = async () => {
    setLoadError(null);
    try {
      const res = await api.get<{ drivers: Driver[] }>("/api/manager/drivers");
      setDrivers(res.data.drivers ?? []);
    } catch (e) {
      setLoadError(formatStageError(STAGES.MANAGER_DRIVERS, ENDPOINTS.MANAGER_DRIVERS, buildErrorMessage(e)));
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, []);

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

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <Spinner size="l" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: 16 }}>
        <div
          style={{
            padding: 12,
            background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
            borderRadius: 8,
            border: "1px solid var(--tg-theme-destructive-text-color, #c00)",
            color: "var(--tg-theme-text-color, #000)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {loadError}
        </div>
        <Button size="l" stretched onClick={() => { setLoading(true); fetchDrivers(); }}>
          Повторить
        </Button>
      </div>
    );
  }

  const isWorking = (status?: string) =>
    status?.toLowerCase() === "working" || status?.toLowerCase() === "online" || status === "free";

  if (selectedDriver) {
    return (
      <DriverDetails
        driver={selectedDriver}
        onBack={() => setSelectedDriver(null)}
      />
    );
  }

  return (
    <List>
      <Section header="Добавить водителя">
        <Input
          header="Номер телефона"
          placeholder="+7999..."
          value={newPhone}
          onChange={(e) => setNewPhone((e.target as HTMLInputElement).value)}
        />
        <div style={{ padding: 16 }}>
          <Button size="l" stretched onClick={handleLinkDriver} loading={linking}>
            Найти и привязать
          </Button>
          {linkError && (
            <p
              style={{
                marginTop: 12,
                fontSize: 13,
                color: "var(--tg-theme-destructive-text-color, #c00)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {linkError}
            </p>
          )}
        </div>
      </Section>

      <Section header={`Мои водители (${drivers.length})`}>
        {drivers.length === 0 ? (
          <Placeholder
            header="Нет водителей"
            description="Добавьте своего первого водителя выше"
          />
        ) : (
          drivers.map((driver) => (
            <Cell
              key={driver.id}
              before={
                <Avatar
                  acronym={driver.name?.[0] ?? driver.phone?.[0] ?? "?"}
                />
              }
              subtitle={driver.phone}
              description={
                driver.balance != null ? `Баланс: ${driver.balance} ₽` : undefined
              }
              after={
                <span style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #666666)" }}>
                  {isWorking(driver.workStatus) ? "На линии" : "Офлайн"}
                </span>
              }
              onClick={() => setSelectedDriver(driver)}
            >
              {driver.name ?? "Без имени"}
            </Cell>
          ))
        )}
      </Section>
    </List>
  );
}
