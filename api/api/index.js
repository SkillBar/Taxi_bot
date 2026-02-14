/**
 * Vercel Serverless Function: /api/*
 * Точка входа, чтобы Vercel распознал функцию (функции ищутся в папке api/).
 * Ждём завершения ответа, иначе функция завершится до отправки (404 и т.п.).
 */
import app from "../_dist/index.js";

export default async function handler(req, res) {
  await app.ready();
  return new Promise((resolve) => {
    const onEnd = () => resolve(undefined);
    res.once("finish", onEnd);
    res.once("close", onEnd);
    app.server.emit("request", req, res);
  });
}
