import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { encryptPlaintext } from "../src/lib/encrypt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

const prisma = new PrismaClient();

const DEFAULT_PARK_DISPLAY_NAME = "Мой Таксопарк";
const DEFAULT_PARK_ID = "28499fad6fb246c6827dcd3452ba1384";
const DEFAULT_CLIENT_ID = "taxi/park/28499fad6fb246c6827dcd3452ba1384";
const DEFAULT_API_KEY = "bIrMRlHxxtSbyXxJsfPebwfGtqqOPbtWlGC";

/** Нормализация номера для БД: только цифры, 8... → 7... */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10 && digits.startsWith("8")) return "7" + digits.slice(1);
  return digits;
}

async function main() {
  const agentPhone = process.env.SEED_AGENT_PHONE || "+79991234567";
  let agent = await prisma.agent.findFirst({ where: { phone: agentPhone } });
  if (!agent) {
    agent = await prisma.agent.create({
      data: { phone: agentPhone, telegramUserId: null, isActive: true },
    });
    console.log("Created test agent:", agent.id, "phone:", agentPhone);
  }

  let fleetPark = await prisma.fleetPark.findFirst({ where: { displayName: DEFAULT_PARK_DISPLAY_NAME } });
  if (!fleetPark) {
    fleetPark = await prisma.fleetPark.create({
      data: {
        parkId: DEFAULT_PARK_ID,
        clientId: DEFAULT_CLIENT_ID,
        apiKeyEnc: encryptPlaintext(process.env.YANDEX_API_KEY || DEFAULT_API_KEY),
        displayName: DEFAULT_PARK_DISPLAY_NAME,
      },
    });
    console.log("Created default FleetPark:", fleetPark.id, fleetPark.displayName);
  }

  const managerPhone = normalizePhone(process.env.SEED_MANAGER_PHONE || "89996697111");
  let manager = await prisma.manager.findFirst({ where: { phone: managerPhone } });
  if (!manager) {
    manager = await prisma.manager.create({
      data: {
        phone: managerPhone,
        fleetParkId: fleetPark.id,
      },
    });
    console.log("Created manager for phone", managerPhone.slice(0, 4) + "***", "fleetParkId:", fleetPark.id);
  } else if (!manager.fleetParkId) {
    manager = await prisma.manager.update({
      where: { id: manager.id },
      data: { fleetParkId: fleetPark.id },
    });
    console.log("Updated manager", manager.id, "fleetParkId:", fleetPark.id);
  } else {
    console.log("Manager already exists with fleetParkId:", manager.fleetParkId);
  }
  console.log("Seed completed. Default park id:", fleetPark.id, "| Manager phone:", managerPhone.slice(0, 4) + "***");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
