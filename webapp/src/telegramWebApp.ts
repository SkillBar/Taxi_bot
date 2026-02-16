/**
 * Инициализация по гайдлайнам Telegram Mini Apps:
 * https://core.telegram.org/bots/webapps
 * Вызывать при загрузке приложения.
 * Используем нативную тему Telegram (светлая/тёмная — как у пользователя).
 */

type TelegramWA = {
  ready: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  themeParams?: { bg_color?: string; secondary_bg_color?: string };
  enableVerticalSwipes?: () => void;
  disableVerticalSwipes?: () => void;
};

export function initTelegramWebApp(): void {
  try {
    const wa = (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: TelegramWA } }).Telegram?.WebApp) as TelegramWA | undefined;
    if (!wa) return;

    wa.ready();
    wa.expand?.();

    // Нативная тема Telegram: подставляем цвета из темы пользователя
    const bg = wa.themeParams?.bg_color;
    if (bg) {
      wa.setHeaderColor?.(bg);
      wa.setBackgroundColor?.(bg);
    }

    // Тяга вниз внутри экрана не закрывает Mini App (удобно для pull-to-refresh и скролла)
    wa.disableVerticalSwipes?.();
  } catch {
    // Вне Telegram или при ошибке SDK — просто не падаем
  }
}
