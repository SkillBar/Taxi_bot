const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export function debugLog(payload: Record<string, unknown>): void {
  const body = JSON.stringify({ ...payload, timestamp: payload.timestamp ?? Date.now() });
  fetch("http://127.0.0.1:7242/ingest/9db056d5-71a1-4d5e-a996-2f8972b20b7c", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {});
  if (API_URL) {
    fetch(`${API_URL}/api/debug-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(
      () => {}
    );
  }
}
