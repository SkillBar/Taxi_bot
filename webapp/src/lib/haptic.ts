/**
 * Лёгкая вибрация при тапах (Telegram WebApp HapticFeedback).
 * Использовать при переключении табов, нажатиях кнопок онбординга и т.д.
 */

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        HapticFeedback?: {
          impactOccurred?: (style: ImpactStyle) => void;
          notificationOccurred?: (type: "error" | "success" | "warning") => void;
        };
      };
    };
  }
}

export function hapticImpact(style: ImpactStyle = "light"): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    // вне Telegram или старый клиент — игнорируем
  }
}
