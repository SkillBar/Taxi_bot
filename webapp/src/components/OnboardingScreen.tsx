import { useState } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Input, Button } from "@telegram-apps/telegram-ui";
import { linkAgentByPhone } from "../api";

const normalizePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  return raw.startsWith("+") ? raw : "+" + (digits || raw);
};

export interface OnboardingScreenProps {
  onLinked: () => void;
}

export function OnboardingScreen({ onLinked }: OnboardingScreenProps) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const normalized = normalizePhone(phone.trim());
    if (!normalized || normalized.length < 11) {
      setError("Введите номер телефона в формате +7 XXX XXX-XX-XX");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await linkAgentByPhone(normalized);
      onLinked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подключить. Обратитесь к администратору.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppRoot>
      <main
        style={{
          minHeight: "100vh",
          background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--tg-theme-text-color)" }}>
            Подключение по номеру Telegram
          </h1>
          <p style={{ fontSize: 14, color: "var(--tg-theme-hint-color)", margin: 0 }}>
            Введите номер телефона, с которым вы зарегистрированы у агента
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Input
            header="Номер телефона"
            placeholder="+7 999 123-45-67"
            value={phone}
            onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
            disabled={loading}
          />
        </div>

        {error && (
          <p style={{ color: "var(--tg-theme-destructive-text-color, #c00)", fontSize: 14, marginBottom: 16 }}>
            {error}
          </p>
        )}

        <Button size="l" stretched onClick={handleSubmit} loading={loading}>
          Подключить
        </Button>
      </main>
    </AppRoot>
  );
}
