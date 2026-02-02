/**
 * Инициализация по гайдлайнам Telegram Mini Apps:
 * https://core.telegram.org/bots/webapps
 * Вызывать при загрузке приложения.
 */

type TelegramWA = {
  ready: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  themeParams?: { bg_color?: string; secondary_bg_color?: string };
  enableVerticalSwipes?: () => void;
};

export function initTelegramWebApp(): void {
  const wa = (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: TelegramWA } }).Telegram?.WebApp) as TelegramWA | undefined;
  if (!wa) return;

  wa.ready();
  wa.expand?.();

  const bg = wa.themeParams?.bg_color;
  if (bg) {
    wa.setHeaderColor?.(bg);
    wa.setBackgroundColor?.(bg);
  }

  wa.enableVerticalSwipes?.();
}
