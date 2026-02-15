/**
 * Сохранение признака «пользователь привязан» между сессиями.
 * При закрытии Mini App localStorage в некоторых клиентах Telegram может очищаться,
 * поэтому при наличии CloudStorage (серверное хранилище TG) дублируем туда.
 */

import { debugLog } from "../debugLog";

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
  // #region debug log
  try {
    if (typeof window === "undefined") return false;
    const out = localStorage.getItem(KEY) === "1";
    debugLog({ location: "sessionStorage.ts:getLinkedSync", message: "getLinkedSync", data: { result: out, raw: localStorage.getItem(KEY) ? "set" : null }, hypothesisId: "H1" });
    return out;
  } catch (e) {
    debugLog({ location: "sessionStorage.ts:getLinkedSync", message: "getLinkedSync catch", data: { err: String(e) }, hypothesisId: "H1" });
    return false;
  }
  // #endregion
}

/** Асинхронно читаем: CloudStorage (если есть), иначе localStorage. */
export async function getLinked(): Promise<boolean> {
  // #region debug log
  try {
    if (typeof window === "undefined") return false;
    const cloud = getCloudStorage();
    const getVal = cloud?.get ?? cloud?.getItem;
    if (getVal) {
      const v = await Promise.resolve(getVal.call(cloud, KEY));
      const out = v === "1" ? true : (v != null && String(v).trim() !== "" ? false : localStorage.getItem(KEY) === "1");
      debugLog({ location: "sessionStorage.ts:getLinked", message: "getLinked", data: { result: out, cloudVal: v == null ? "null" : v === "" ? "empty" : "other" }, hypothesisId: "H1" });
      return out;
    }
    const out = localStorage.getItem(KEY) === "1";
    debugLog({ location: "sessionStorage.ts:getLinked", message: "getLinked noCloud", data: { result: out }, hypothesisId: "H1" });
    return out;
  } catch (e) {
    const out = localStorage.getItem(KEY) === "1";
    debugLog({ location: "sessionStorage.ts:getLinked", message: "getLinked catch", data: { result: out, err: String(e) }, hypothesisId: "H1" });
    return out;
  }
  // #endregion
}

/** Пишем в localStorage и в CloudStorage (чтобы пережить закрытие приложения). */
export function setLinked(linked: boolean): void {
  // #region debug log
  debugLog({ location: "sessionStorage.ts:setLinked", message: "setLinked called", data: { linked }, hypothesisId: "H4" });
  // #endregion
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
