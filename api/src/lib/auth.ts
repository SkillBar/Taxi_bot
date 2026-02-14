/**
 * Централизованная авторизация API.
 * — Mini App: x-telegram-init-data → requireInitData
 * — Бот: X-Api-Secret → requireBotSecret
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { validateInitData, parseInitData } from "./telegram.js";
import { config } from "../config.js";

export const INIT_DATA_MAX_AGE_SEC = 86400; // 24 ч

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export interface RequestWithTelegram extends FastifyRequest {
  telegramUserId?: number;
  telegramUser?: TelegramUser;
}

/** PreHandler: проверяет initData, вешает telegramUserId и telegramUser на req. Вызвать next() при успехе. */
export async function requireInitData(
  req: FastifyRequest,
  reply: FastifyReply,
  next: (err?: Error) => void
): Promise<void> {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData) {
    reply.status(401).send({
      error: "Missing x-telegram-init-data",
      message: "Откройте приложение из Telegram — заголовок авторизации не передан.",
    });
    return;
  }
  if (!validateInitData(initData, config.botToken, INIT_DATA_MAX_AGE_SEC)) {
    reply.status(401).send({
      error: "Invalid initData",
      message: "Неверная или устаревшая подпись. Перезапустите Mini App из Telegram.",
    });
    return;
  }
  const { user } = parseInitData(initData);
  if (!user?.id) {
    reply.status(401).send({ error: "User not in initData", message: "В initData отсутствует user." });
    return;
  }
  (req as RequestWithTelegram).telegramUserId = user.id;
  (req as RequestWithTelegram).telegramUser = user as TelegramUser;
  next();
}

/** PreHandler: проверяет X-Api-Secret (вызовы от бота). */
export async function requireBotSecret(
  req: FastifyRequest,
  reply: FastifyReply,
  next: (err?: Error) => void
): Promise<void> {
  const secret = (req.headers["x-api-secret"] as string) || "";
  if (!config.apiSecret || secret !== config.apiSecret) {
    req.log.warn({ auth: "requireBotSecret", result: "invalid" });
    reply.status(401).send({ error: "Invalid or missing X-Api-Secret" });
    return;
  }
  next();
}
