import crypto from "node:crypto";

/**
 * Validates Telegram WebApp initData (HMAC-SHA256).
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");
  if (!hash) return false;

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return computed === hash;
}

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export function parseInitData(initData: string): { user?: TelegramUser; auth_date?: string } {
  const params = new URLSearchParams(initData);
  const userStr = params.get("user");
  const authDate = params.get("auth_date") || undefined;
  let user: TelegramUser | undefined;
  if (userStr) {
    try {
      const u = JSON.parse(userStr) as TelegramUser;
      user = u;
    } catch {
      // ignore
    }
  }
  return { user, auth_date: authDate };
}
