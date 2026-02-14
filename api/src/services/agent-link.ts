/**
 * Сервис привязки агента по телефону (используется ботом при message:contact).
 */

import { prisma } from "../db.js";
import { config } from "../config.js";

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  return raw.startsWith("+") ? raw : "+" + digits;
}

type ExternalAgentCheck = {
  found: boolean;
  externalId?: string | null;
  isActive?: boolean;
  message?: string;
};

export async function checkExternalAgent(phone: string): Promise<ExternalAgentCheck | null> {
  if (!config.agentCheckUrl) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.agentCheckApiKey) {
    headers["X-API-Key"] = config.agentCheckApiKey;
    headers["Authorization"] = `Bearer ${config.agentCheckApiKey}`;
  }
  const res = await fetch(config.agentCheckUrl, { method: "POST", headers, body: JSON.stringify({ phone }) });
  if (!res.ok) return { found: false, message: "Ошибка проверки номера. Попробуйте позже." };
  const data = (await res.json()) as Record<string, unknown>;
  const found = Boolean(data?.found || data?.isFound || data?.ok);
  const externalId = (data?.externalId != null ? data.externalId : data?.agentId != null ? data.agentId : data?.id) as string | null;
  const isActive = Boolean(data?.isActive != null ? data.isActive : data?.active != null ? data.active : found);
  const message = data?.message as string | undefined;
  return { found, externalId, isActive, message };
}

export async function upsertAgentFromExternal(
  phone: string,
  externalId: string | null,
  isActive: boolean
) {
  if (externalId) {
    const existing = await prisma.agent.findUnique({ where: { externalId } });
    if (existing) {
      return prisma.agent.update({
        where: { id: existing.id },
        data: { phone, isActive },
      });
    }
  }
  const existingByPhone = await prisma.agent.findFirst({ where: { phone } });
  if (existingByPhone) {
    return prisma.agent.update({
      where: { id: existingByPhone.id },
      data: { externalId: externalId || existingByPhone.externalId, isActive },
    });
  }
  return prisma.agent.create({
    data: { phone, externalId: externalId || undefined, isActive },
  });
}

export type LinkAgentResult =
  | { ok: true; agentId: string }
  | { ok: false; status: number; message: string };

/** Привязать telegramUserId к агенту по номеру телефона (вызов от бота). */
export async function linkAgentByTelegramId(
  phone: string,
  telegramUserId: string
): Promise<LinkAgentResult> {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 10) {
    return { ok: false, status: 400, message: "phone and telegramUserId required" };
  }

  let agent = await prisma.agent.findFirst({
    where: { phone: normalized, isActive: true },
  });
  if (!agent) {
    const external = await checkExternalAgent(normalized);
    if (!external?.found || !external.isActive) {
      return {
        ok: false,
        status: 404,
        message: external?.message || "Ваш номер не найден в системе. Обратитесь к администратору.",
      };
    }
    agent = await upsertAgentFromExternal(normalized, external.externalId || null, true);
  }

  await prisma.agent.update({
    where: { id: agent.id },
    data: { telegramUserId },
  });
  return { ok: true, agentId: agent.id };
}
