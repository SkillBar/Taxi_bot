const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export interface TelegramWebApp {
  initData: string;
  ready: () => void;
  close: () => void;
  sendData: (data: string) => void;
  MainButton?: { show: () => void; hide: () => void; setText: (t: string) => void; onClick: (cb: () => void) => void };
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function getInitData(): string {
  const w = window.Telegram?.WebApp?.initData;
  return w ?? "";
}

const FETCH_TIMEOUT_MS = 20000; // 20 сек — иначе «тишина» при недоступном API

function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

const headers = (): HeadersInit => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(),
});

export type AgentsMe = {
  telegramUserId: number;
  firstName: string | null;
  lastName: string | null;
  linked: boolean;
};

/** Диагностика: проверка доходимости до API и CORS (без initData). */
export async function getApiPing(): Promise<{ ok: boolean; origin?: string | null; url?: string; t?: number }> {
  const res = await fetchWithTimeout(`${API_URL}/ping`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getAgentsMe(): Promise<AgentsMe> {
  const res = await fetchWithTimeout(`${API_URL}/api/agents/me`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(body) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function linkAgentByPhone(phone: string): Promise<{ agentId: string }> {
  const res = await fetchWithTimeout(`${API_URL}/api/agents/link`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message ?? (data as { error?: string }).error ?? "Ошибка привязки");
  }
  return res.json();
}

export type Draft = {
  id: string;
  type: "driver" | "courier";
  status: string;
  selectedTariffId: string | null;
  executor: {
    fio: string | null;
    phone: string | null;
    experience: string | null;
    license: string | null;
    licenseCountry: string | null;
    licenseIssueDate: string | null;
    licenseValidUntil: string | null;
  };
  car: {
    brand: string | null;
    model: string | null;
    color: string | null;
    year: number | null;
    plate: string | null;
    sts: string | null;
  };
  executorTariffs: string[];
  brandingWrap: boolean;
  brandingLightbox: boolean;
};

export async function getCurrentDraft(): Promise<Draft | null> {
  const res = await fetch(`${API_URL}/api/drafts/current`, { headers: headers() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data as Draft | null;
}

export async function createDraft(type: "driver" | "courier"): Promise<Draft> {
  const res = await fetchWithTimeout(`${API_URL}/api/drafts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ type }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateDraft(draftId: string, patch: Record<string, unknown>): Promise<Draft> {
  const res = await fetchWithTimeout(`${API_URL}/api/drafts/${draftId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function submitDraft(draftId: string): Promise<{
  success: boolean;
  message: string;
  executorId?: string;
  linkExecutor?: string;
  linkStats?: string;
}> {
  const res = await fetch(`${API_URL}/api/drafts/${draftId}/submit`, {
    method: "POST",
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.details ?? "Submit failed");
  return data;
}

export type AgentTariff = { id: string; commissionPercent: number; name?: string };

export async function getAgentTariffs(): Promise<AgentTariff[]> {
  const res = await fetchWithTimeout(`${API_URL}/api/agents/me/tariffs`, { headers: headers() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.tariffs ?? []) as AgentTariff[];
}

export async function createAgentTariff(commissionPercent: number): Promise<AgentTariff> {
  const res = await fetchWithTimeout(`${API_URL}/api/agents/me/tariffs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ commissionPercent }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type ExecutorTariffOption = { id: string; name: string };

export async function getExecutorTariffs(type: "driver" | "courier"): Promise<ExecutorTariffOption[]> {
  const res = await fetchWithTimeout(
    `${API_URL}/api/executor-tariffs?type=${type}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.tariffs ?? []) as ExecutorTariffOption[];
}
