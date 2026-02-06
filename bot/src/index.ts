import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { Bot, session, type SessionFlavor } from "grammy";

type SessionData = {
  step?: "contact" | "email" | "menu";
  phone?: string;
  agentId?: string;
};

type BotContext = { session: SessionData };

const bot = new Bot<BotContext>(process.env.BOT_TOKEN!);

bot.use(
  session({
    initial: (): SessionData => ({}),
  })
);

const API_URL = (process.env.API_URL || "http://localhost:3001").replace(/\/$/, "");
const WEBAPP_URL = (process.env.WEBAPP_URL || "").replace(/\/$/, "");

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  return raw.startsWith("+") ? raw : "+" + digits;
}

async function ensureAgentByTelegramId(telegramUserId: string): Promise<{ id: string; hasEmail: boolean } | null> {
  const res = await fetch(`${API_URL}/api/agents/by-telegram/${telegramUserId}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { agentId: string; yandexEmail?: string };
  return { id: j.agentId, hasEmail: !!j.yandexEmail };
}

bot.command("start", async (ctx) => {
  const tid = String(ctx.from?.id);
  const existing = await ensureAgentByTelegramId(tid);
  if (existing) {
    if (!existing.hasEmail) {
      ctx.session.step = "email";
      ctx.session.agentId = existing.id;
      await ctx.reply("Введите вашу почту Яндекс для дальнейшей работы в системе.");
      return;
    }
    ctx.session.step = "menu";
    ctx.session.agentId = existing.id;
    await showMainMenu(ctx);
    return;
  }
  ctx.session.step = "contact";
  await ctx.reply("Подтвердите номер телефона для входа в систему.", {
    reply_markup: {
      one_time_keyboard: true,
      keyboard: [[{ text: "Отправить контакт", request_contact: true }]],
    },
  });
});

// Контакт приходит и из чата (после /start), и из Mini App (requestContact)
bot.on("message:contact", async (ctx) => {
  const phone = ctx.message.contact?.phone_number
    ? normalizePhone(ctx.message.contact.phone_number)
    : "";
  if (!phone) {
    await ctx.reply("Не удалось определить номер. Используйте кнопку «Отправить контакт».");
    return;
  }
  const res = await fetch(
    `${API_URL}/api/agents/check?phone=${encodeURIComponent(phone)}`
  );
  const data = (await res.json()) as { found?: boolean; agentId?: string; message?: string };
  if (!data.found) {
    await ctx.reply(
      data.message || "Ваш номер не найден в системе. Обратитесь к администратору."
    );
    return;
  }
  const linkRes = await fetch(`${API_URL}/api/agents/link-from-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.API_SECRET && { "X-Api-Secret": process.env.API_SECRET }),
    },
    body: JSON.stringify({ phone, telegramUserId: String(ctx.from?.id) }),
  });
  if (!linkRes.ok) {
    const err = (await linkRes.json().catch(() => ({}))) as { message?: string };
    await ctx.reply(err.message || "Ошибка привязки аккаунта. Повторите /start");
    return;
  }
  ctx.session.agentId = data.agentId;
  ctx.session.phone = phone;
  const fromMiniApp = ctx.session.step !== "contact";
  if (fromMiniApp) {
    ctx.session.step = "menu";
    await ctx.reply("Номер подтверждён. Вернитесь в приложение.");
  } else {
    ctx.session.step = "email";
    await ctx.reply("Введите вашу почту Яндекс для дальнейшей работы в системе.", {
      reply_markup: { remove_keyboard: true },
    });
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text?.trim() || "";
  if (ctx.session.step === "email") {
    const emailRe = /^[^\s@]+@(yandex\.ru|ya\.ru|yandex\.com|yandex\.by|yandex\.kz)$/i;
    if (!emailRe.test(text)) {
      await ctx.reply("Введите корректный email в формате name@yandex.ru");
      return;
    }
    const agentId = ctx.session.agentId;
    if (!agentId) {
      await ctx.reply("Сессия сброшена. Отправьте /start");
      return;
    }
    const res = await fetch(`${API_URL}/api/agents/${agentId}/email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yandexEmail: text }),
    });
    if (!res.ok) {
      await ctx.reply("Ошибка сохранения. Повторите позже.");
      return;
    }
    ctx.session.step = "menu";
    await ctx.reply("Спасибо, почта принята ✅");
    await showMainMenu(ctx);
    return;
  }
  if (ctx.session.step === "menu") {
    if (text === "Посмотреть статистику") {
      await ctx.reply("Загрузка статистики…");
      const headers: Record<string, string> = {};
      if (process.env.API_SECRET) headers["X-Api-Secret"] = process.env.API_SECRET;
      const statsRes = await fetch(
        `${API_URL}/api/stats?agentId=${ctx.session.agentId}`,
        { headers }
      );
      if (!statsRes.ok) {
        await ctx.reply("Не удалось загрузить статистику. Откройте раздел в приложении.");
        return;
      }
      const stats = (await statsRes.json()) as {
        totalRegistered?: number;
        registeredInPeriod?: number;
        period?: string;
      };
      const periodLabel = stats.period === "day" ? "за день" : stats.period === "week" ? "за неделю" : "за месяц";
      await ctx.reply(
        `📊 Статистика (${periodLabel})\n\n` +
          `Всего зарегистрировано: ${stats.totalRegistered || 0}\n` +
          `За период: ${stats.registeredInPeriod || 0}`,
        WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "Открыть в кабинете", url: `${WEBAPP_URL}/stats` }]] } } : undefined
      );
      return;
    }
    if (text === "Зарегистрировать водителя" || text === "Зарегистрировать авто курьера") {
      await ctx.reply("Открываю приложение — первый экран: выбор типа регистрации.", {
        reply_markup: {
          keyboard: [[{ text: "📋 Открыть приложение", web_app: { url: WEBAPP_URL } }]],
        },
      });
      return;
    }
  }
});

bot.on("message:web_app_data", async (ctx) => {
  const payload = ctx.message.web_app_data?.data;
  if (!payload) return;
  try {
    const data = JSON.parse(payload) as {
      action: string;
      draftId?: string;
      message?: string;
      executorId?: string;
      linkExecutor?: string;
      linkStats?: string;
    };
    if (data.action === "submitted") {
      let text = data.message || "Спасибо, исполнитель успешно зарегистрирован ✅";
      if (data.linkExecutor) text += `\n\nПосмотреть данные: ${data.linkExecutor}`;
      if (data.linkStats) text += `\nСтатистика: ${data.linkStats}`;
      await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
      await showMainMenu(ctx);
    } else if (data.action === "cancelled") {
      await ctx.reply("Регистрация отменена.", { reply_markup: { remove_keyboard: true } });
      await showMainMenu(ctx);
    }
  } catch {
    await ctx.reply("Данные получены. Регистрация завершена.");
    await showMainMenu(ctx);
  }
});

async function showMainMenu(ctx: { reply: (text: string, opts?: object) => Promise<unknown> }) {
  const keyboard: { text: string; web_app?: { url: string } }[][] = [];
  keyboard.push(["Посмотреть статистику"]);
  if (WEBAPP_URL) {
    keyboard.push([{ text: "📋 Регистрация исполнителя", web_app: { url: WEBAPP_URL } }]);
  } else {
    keyboard.push(
      ["Зарегистрировать водителя"],
      ["Зарегистрировать авто курьера"]
    );
  }
  await ctx.reply("Главное меню", {
    reply_markup: { keyboard, resize_keyboard: true },
  });
}

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start();
