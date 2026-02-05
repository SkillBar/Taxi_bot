// Чтение env только внутри функции — Vercel NFT не разбирает тело функции,
// иначе падает на PropertyAccessExpression (process.env.*).
function getConfig() {
  return {
    port: 3001,
    host: process.env.HOST,
    databaseUrl: process.env.DATABASE_URL!,
    botToken: process.env.BOT_TOKEN!,
    apiSecret: process.env.API_SECRET || "",
    webappUrl: process.env.WEBAPP_URL || "",
    agentCheckUrl: process.env.AGENT_CHECK_URL,
    agentCheckApiKey: process.env.AGENT_CHECK_API_KEY,
    registrationSubmitUrl: process.env.REGISTRATION_SUBMIT_URL,
    registrationSubmitApiKey: process.env.REGISTRATION_SUBMIT_API_KEY,
    yandexParkId: process.env.YANDEX_PARK_ID,
    yandexClientId: process.env.YANDEX_CLIENT_ID,
    yandexApiKey: process.env.YANDEX_API_KEY,
  };
}

export const config = getConfig();
