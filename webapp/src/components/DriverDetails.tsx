import { useEffect } from "react";
import { backButton } from "@telegram-apps/sdk-react";
import {
  List,
  Section,
  Cell,
  Avatar,
  Button,
  Badge,
} from "@telegram-apps/telegram-ui";
import type { Driver } from "./ManagerDashboard";

export interface DriverDetailsProps {
  driver: Driver;
  onBack: () => void;
}

const isWorking = (status?: string) =>
  status?.toLowerCase() === "working" ||
  status?.toLowerCase() === "online" ||
  status === "free";

export function DriverDetails({ driver, onBack }: DriverDetailsProps) {
  useEffect(() => {
    try {
      if (backButton?.show?.isAvailable?.()) backButton.show();
      const off = backButton?.onClick?.isAvailable?.() ? backButton.onClick(onBack) : () => {};
      return () => {
        if (typeof off === "function") off();
        if (backButton?.hide?.isAvailable?.()) backButton.hide();
      };
    } catch {
      return () => {};
    }
  }, [onBack]);

  const statusLabel = isWorking(driver.workStatus) ? "На линии" : "Офлайн";

  const handleCall = () => {
    const tel = driver.phone.replace(/\s/g, "");
    window.open(`tel:${tel}`, "_self");
  };

  return (
    <List>
      <Section>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px" }}>
          <Avatar
            size={96}
            acronym={driver.name?.[0] ?? driver.phone?.[0] ?? "?"}
          />
          <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>
            {driver.name ?? "Без имени"}
          </h2>
          <Badge
            type="number"
            mode={isWorking(driver.workStatus) ? "primary" : "gray"}
          >
            {statusLabel}
          </Badge>
        </div>
      </Section>

      <Section header="Контакт">
        <Cell subtitle="Телефон">{driver.phone}</Cell>
      </Section>

      <Section header="Финансы">
        <Cell
          subtitle="Баланс"
          after={
            driver.balance != null ? `${driver.balance} ₽` : "—"
          }
        />
        <Cell
          subtitle="Лимит"
          after={
            (driver as Driver & { limit?: number }).limit != null
              ? `${(driver as Driver & { limit?: number }).limit} ₽`
              : "—"
          }
        />
      </Section>

      <Section>
        <div style={{ padding: 16 }}>
          <Button size="l" stretched onClick={handleCall}>
            Позвонить водителю
          </Button>
        </div>
      </Section>
    </List>
  );
}
