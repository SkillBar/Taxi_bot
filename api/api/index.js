/**
 * Vercel Serverless Function: /api/*
 * Точка входа, чтобы Vercel распознал функцию (функции ищутся в папке api/).
 */
import app from "../_dist/index.js";

export default async function handler(req, res) {
  await app.ready();
  app.server.emit("request", req, res);
}
