/**
 * Yandex OAuth 2.0 (Yandex ID) для водителя: логин через Яндекс → access_token для Fleet API от его имени.
 * https://yandex.ru/dev/id/doc/en/codes/code-url
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";

const YANDEX_AUTHORIZE = "https://oauth.yandex.com/authorize";
const YANDEX_TOKEN = "https://oauth.yandex.com/token";

// Scopes для доступа к данным водителя в Fleet (указать при регистрации приложения в oauth.yandex.com)
const DEFAULT_SCOPE = "login:email login:info";

function stateEncode(telegramUserId: string): string {
  return Buffer.from(telegramUserId, "utf8").toString("base64url");
}

function stateDecode(state: string): string | null {
  try {
    return Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export async function yandexOAuthRoutes(app: FastifyInstance) {
  const clientId = config.yandexOAuthClientId;
  const clientSecret = config.yandexOAuthClientSecret;
  const redirectUri = config.yandexOAuthRedirectUri;
  const webappUrl = config.webappUrl || "";

  if (!clientId || !clientSecret || !redirectUri) {
    app.log.warn("Yandex OAuth not configured (YANDEX_OAUTH_CLIENT_ID, YANDEX_OAUTH_CLIENT_SECRET, YANDEX_OAUTH_REDIRECT_URI); /api/yandex-oauth disabled");
    return;
  }

  /**
   * GET /api/yandex-oauth/authorize-url
   * Заголовок: x-telegram-init-data.
   * Возвращает URL для редиректа водителя на страницу входа Яндекс.
   */
  app.get("/authorize-url", async (req: FastifyRequest, reply: FastifyReply) => {
    const initData = (req.headers["x-telegram-init-data"] as string) || "";
    if (!initData || !validateInitData(initData, config.botToken, 86400)) {
      return reply.status(401).send({ error: "Invalid or missing initData" });
    }
    const { user } = parseInitData(initData);
    if (!user?.id) return reply.status(401).send({ error: "User not in initData" });

    const state = stateEncode(String(user.id));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: DEFAULT_SCOPE,
      state,
    });
    const url = `${YANDEX_AUTHORIZE}?${params.toString()}`;
    return reply.send({ url });
  });

  /**
   * GET /api/yandex-oauth/callback?code=...&state=...
   * Вызывается редиректом от Яндекса после входа водителя. Обменивает code на токены, сохраняет в БД, редирект в Mini App.
   */
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/callback", async (req, reply) => {
    const { code, state, error, error_description } = req.query;
    const redirectTo = webappUrl ? `${webappUrl.replace(/\/$/, "")}?yandex_oauth=linked` : "";

    if (error) {
      app.log.warn({ error, error_description }, "Yandex OAuth callback error");
      if (redirectTo) return reply.redirect(302, `${redirectTo}&error=${encodeURIComponent(error)}`);
      return reply.status(400).send({ error, error_description });
    }

    if (!code || !state) {
      if (redirectTo) return reply.redirect(302, `${redirectTo}&error=missing_params`);
      return reply.status(400).send({ error: "code and state required" });
    }

    const telegramUserId = stateDecode(state);
    if (!telegramUserId) {
      if (redirectTo) return reply.redirect(302, `${redirectTo}&error=invalid_state`);
      return reply.status(400).send({ error: "Invalid state" });
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    let tokenRes: Response;
    try {
      tokenRes = await fetch(YANDEX_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (e) {
      app.log.error(e);
      if (redirectTo) return reply.redirect(302, `${redirectTo}&error=token_request_failed`);
      return reply.status(502).send({ error: "Token request failed" });
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenData.access_token || !tokenData.refresh_token) {
      app.log.warn({ status: tokenRes.status, tokenData }, "Yandex OAuth token exchange failed");
      if (redirectTo) return reply.redirect(302, `${redirectTo}&error=token_exchange_failed`);
      return reply.status(400).send({ error: tokenData.error || "token_exchange_failed", error_description: tokenData.error_description });
    }

    const expiresIn = tokenData.expires_in != null ? tokenData.expires_in : 31536000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await prisma.driverYandexOAuth.upsert({
      where: { telegramUserId },
      create: {
        telegramUserId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope != null ? tokenData.scope : null,
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope != null ? tokenData.scope : null,
      },
    });

    app.log.info({ telegramUserId }, "Yandex OAuth linked for driver");

    if (redirectTo) return reply.redirect(302, redirectTo);
    return reply.send({ ok: true, message: "Yandex account linked" });
  });
}

