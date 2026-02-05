import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { validateInitData, parseInitData } from "../lib/telegram.js";
import { config } from "../config.js";

async function authFromInitData(req: FastifyRequest, reply: FastifyReply) {
  const initData = (req.headers["x-telegram-init-data"] as string) || "";
  if (!initData || !validateInitData(initData, config.botToken)) {
    return reply.status(401).send({ error: "Invalid or missing initData" });
  }
  const { user } = parseInitData(initData);
  if (!user?.id) return reply.status(401).send({ error: "User not in initData" });
  (req as any).telegramUserId = user.id;
}

export async function draftRoutes(app: FastifyInstance) {
  // Get or create current in_progress draft for agent
  app.get("/current", {
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as any).telegramUserId);
    const agent = await prisma.agent.findUnique({ where: { telegramUserId } });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    let draft = await prisma.registrationDraft.findFirst({
      where: { agentId: agent.id, status: "in_progress" },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send(draft ? serializeDraft(draft) : null);
  });

  // Create new draft
  app.post<{
    Body: { type: "driver" | "courier" };
  }>("/", {
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as any).telegramUserId);
    const { type } = req.body || {};
    if (type !== "driver" && type !== "courier")
      return reply.status(400).send({ error: "type must be driver or courier" });

    const agent = await prisma.agent.findUnique({ where: { telegramUserId } });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const draft = await prisma.registrationDraft.create({
      data: { agentId: agent.id, type },
    });
    return reply.send(serializeDraft(draft));
  });

  // Update draft (partial)
  app.patch<{
    Params: { draftId: string };
    Body: Record<string, unknown>;
  }>("/:draftId", {
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as any).telegramUserId);
    const { draftId } = req.params;
    const body = req.body as Record<string, unknown>;

    const agent = await prisma.agent.findUnique({ where: { telegramUserId } });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const draft = await prisma.registrationDraft.findFirst({
      where: { id: draftId, agentId: agent.id, status: "in_progress" },
    });
    if (!draft) return reply.status(404).send({ error: "Draft not found" });

    const allowed: Record<string, string> = {
      selectedTariffId: "selectedTariffId",
      executorFio: "executorFio",
      executorPhone: "executorPhone",
      executorExperience: "executorExperience",
      executorLicense: "executorLicense",
      executorLicenseCountry: "executorLicenseCountry",
      executorLicenseIssueDate: "executorLicenseIssueDate",
      executorLicenseValidUntil: "executorLicenseValidUntil",
      carBrand: "carBrand",
      carModel: "carModel",
      carColor: "carColor",
      carYear: "carYear",
      carPlate: "carPlate",
      carSts: "carSts",
      executorTariffs: "executorTariffs",
      brandingWrap: "brandingWrap",
      brandingLightbox: "brandingLightbox",
    };

    const data: Record<string, unknown> = {};
    for (const [key, dbKey] of Object.entries(allowed)) {
      if (body[key] === undefined) continue;
      if (key === "executorTariffs" && Array.isArray(body[key]))
        data[dbKey] = JSON.stringify(body[key]);
      else if (key === "carYear" && typeof body[key] === "number") data[dbKey] = body[key];
      else if ((key === "brandingWrap" || key === "brandingLightbox") && typeof body[key] === "boolean")
        data[dbKey] = body[key];
      else if (typeof body[key] === "string") data[dbKey] = body[key];
    }

    const updated = await prisma.registrationDraft.update({
      where: { id: draftId },
      data,
    });
    return reply.send(serializeDraft(updated));
  });

  // Submit draft (final registration)
  app.post<{
    Params: { draftId: string };
  }>("/:draftId/submit", {
    preHandler: authFromInitData,
  }, async (req, reply) => {
    const telegramUserId = String((req as any).telegramUserId);
    const { draftId } = req.params;

    const agent = await prisma.agent.findUnique({ where: { telegramUserId } });
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const draft = await prisma.registrationDraft.findFirst({
      where: { id: draftId, agentId: agent.id, status: "in_progress" },
    });
    if (!draft) return reply.status(404).send({ error: "Draft not found" });

    // Validate required fields
    const required = [
      draft.selectedTariffId,
      draft.executorFio,
      draft.executorPhone,
      draft.executorLicense,
      draft.carBrand,
      draft.carModel,
      draft.carPlate,
    ];
    if (required.some((v) => !v))
      return reply.status(400).send({ error: "Не все обязательные поля заполнены" });

    // Optional: call REGISTRATION_SUBMIT_URL here
    let submittedExecutorId: string | null = null;
    if (config.registrationSubmitUrl) {
      try {
        const res = await fetch(config.registrationSubmitUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.registrationSubmitApiKey && { Authorization: `Bearer ${config.registrationSubmitApiKey}` }),
          },
          body: JSON.stringify({
            agentId: agent.externalId || agent.id,
            type: draft.type,
            executor: {
              fio: draft.executorFio,
              phone: draft.executorPhone,
              experience: draft.executorExperience,
              license: draft.executorLicense,
              licenseCountry: draft.executorLicenseCountry,
              licenseIssueDate: draft.executorLicenseIssueDate,
              licenseValidUntil: draft.executorLicenseValidUntil,
            },
            car: {
              brand: draft.carBrand,
              model: draft.carModel,
              color: draft.carColor,
              year: draft.carYear,
              plate: draft.carPlate,
              sts: draft.carSts,
            },
            agentTariffId: draft.selectedTariffId,
            executorTariffs: draft.executorTariffs ? JSON.parse(draft.executorTariffs) : [],
            brandingWrap: draft.brandingWrap || false,
            brandingLightbox: draft.brandingLightbox || false,
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as { executorId?: string };
          submittedExecutorId = json.executorId || null;
        } else {
          const text = await res.text();
          return reply.status(502).send({
            error: "Ошибка регистрации во внешней системе. Повторите позже или обратитесь в поддержку.",
            details: text.slice(0, 200),
          });
        }
      } catch (e) {
        return reply.status(502).send({
          error: "Ошибка регистрации: сервис недоступен. Повторите позже или обратитесь в поддержку.",
        });
      }
    } else {
      // Mock success
      submittedExecutorId = "mock-" + draft.id;
    }

    await prisma.registrationDraft.update({
      where: { id: draftId },
      data: { status: "done", submittedExecutorId },
    });

    return reply.send({
      success: true,
      message: "Спасибо, исполнитель успешно зарегистрирован ✅",
      executorId: submittedExecutorId,
      // Links (format depends on your system)
      linkExecutor: config.webappUrl ? `${config.webappUrl}/executor/${submittedExecutorId}` : undefined,
      linkStats: config.webappUrl ? `${config.webappUrl}/stats` : undefined,
    });
  });
}

function serializeDraft(d: {
  id: string;
  type: string;
  status: string;
  selectedTariffId: string | null;
  executorFio: string | null;
  executorPhone: string | null;
  executorExperience: string | null;
  executorLicense: string | null;
  executorLicenseCountry: string | null;
  executorLicenseIssueDate: string | null;
  executorLicenseValidUntil: string | null;
  carBrand: string | null;
  carModel: string | null;
  carColor: string | null;
  carYear: number | null;
  carPlate: string | null;
  carSts: string | null;
  executorTariffs: string | null;
  brandingWrap: boolean | null;
  brandingLightbox: boolean | null;
}) {
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    selectedTariffId: d.selectedTariffId,
    executor: {
      fio: d.executorFio,
      phone: d.executorPhone,
      experience: d.executorExperience,
      license: d.executorLicense,
      licenseCountry: d.executorLicenseCountry,
      licenseIssueDate: d.executorLicenseIssueDate,
      licenseValidUntil: d.executorLicenseValidUntil,
    },
    car: {
      brand: d.carBrand,
      model: d.carModel,
      color: d.carColor,
      year: d.carYear,
      plate: d.carPlate,
      sts: d.carSts,
    },
    executorTariffs: d.executorTariffs ? JSON.parse(d.executorTariffs) : [],
    brandingWrap: d.brandingWrap || false,
    brandingLightbox: d.brandingLightbox || false,
  };
}
