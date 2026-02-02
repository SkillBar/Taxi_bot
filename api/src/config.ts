export const config = {
  port: process.env.PORT ?? "3001",
  host: process.env.HOST,
  databaseUrl: process.env.DATABASE_URL!,
  botToken: process.env.BOT_TOKEN!,
  apiSecret: process.env.API_SECRET ?? "",
  webappUrl: process.env.WEBAPP_URL ?? "",
  agentCheckUrl: process.env.AGENT_CHECK_URL,
  agentCheckApiKey: process.env.AGENT_CHECK_API_KEY,
  registrationSubmitUrl: process.env.REGISTRATION_SUBMIT_URL,
  registrationSubmitApiKey: process.env.REGISTRATION_SUBMIT_API_KEY,
};
