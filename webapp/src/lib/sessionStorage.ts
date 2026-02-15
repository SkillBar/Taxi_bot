/**
 * Сохранение признака «пользователь привязан» между сессиями.
 * При закрытии Mini App localStorage в некоторых клиентах Telegram может очищаться,
 * поэтому при наличии CloudStorage (серверное хранилище TG) дублируем туда.
 */

const KEY = "agent_linked";

type CloudStorageLike = {
  set?: (key: string, value: string) => void | Promise<unknown>;
  get?: (key: string) => string | Promise<string>;
  setItem?: (key: string, value: string) => void | Promise<unknown>;
  getItem?: (key: string) => string | Promise<string | null>;
};
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        CloudStorage?: CloudStorageLike;
      };
    };
  }
}

function getCloudStorage(): CloudStorageLike | undefined {
  return typeof window !== "undefined" ? window.Telegram?.WebApp?.CloudStorage : undefined;
}

/** Синхронно читаем из localStorage (основной источник при первом рендере). */
export function getLinkedSync(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Асинхронно читаем: CloudStorage (если есть), иначе localStorage. */
export async function getLinked(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    const cloud = getCloudStorage();
    const getVal = cloud?.get ?? cloud?.getItem;
    if (getVal) {
      const v = await Promise.resolve(getVal.call(cloud, KEY));
      if (v === "1") return true;
      if (v != null && String(v).trim() !== "") return false;
    }
    return localStorage.getItem(KEY) === "1";
  } catch {
    return localStorage.getItem(KEY) === "1";
  }
}

/** Пишем в localStorage и в CloudStorage (чтобы пережить закрытие приложения). */
export function setLinked(linked: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (linked) {
      localStorage.setItem(KEY, "1");
      const cloud = getCloudStorage();
      const setVal = cloud?.set ?? cloud?.setItem;
      if (setVal) Promise.resolve(setVal.call(cloud, KEY, "1")).catch(() => {});
    } else {
      localStorage.removeItem(KEY);
      const cloud = getCloudStorage();
      const setVal = cloud?.set ?? cloud?.setItem;
      if (setVal) Promise.resolve(setVal.call(cloud, KEY, "")).catch(() => {});
    }
  } catch {
    // ignore
  }
}
