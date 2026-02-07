import { useEffect, useState } from "react";
import { api } from "../lib/api";
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
}

export function ManagerDashboard() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPhone, setNewPhone] = useState("");
  const [linking, setLinking] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  const fetchDrivers = async () => {
    try {
      const res = await api.get<{ drivers: Driver[] }>("/api/manager/drivers");
      setDrivers(res.data.drivers ?? []);
    } catch (e) {
      console.error("Ошибка загрузки водителей", e);
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Не удалось загрузить список";
      alert(msg);
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
    setLinking(true);
    try {
      await api.post("/api/manager/link-driver", { phone });
      setNewPhone("");
      await fetchDrivers();
      alert("Водитель успешно привязан!");
    } catch (e: unknown) {
      console.error(e);
      const err = e as { response?: { data?: { error?: string; message?: string } } };
      const msg = err.response?.data?.message ?? err.response?.data?.error ?? "Ошибка привязки. Проверьте номер.";
      alert(msg);
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
