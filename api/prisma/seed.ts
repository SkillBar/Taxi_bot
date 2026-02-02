import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const phone = process.env.SEED_AGENT_PHONE ?? "+79991234567";
  const existing = await prisma.agent.findFirst({ where: { phone } });
  if (existing) {
    console.log("Agent already exists:", existing.id);
    return;
  }
  const agent = await prisma.agent.create({
    data: {
      phone,
      telegramUserId: null,
      isActive: true,
    },
  });
  console.log("Created test agent:", agent.id, "phone:", phone);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
