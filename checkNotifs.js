const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const notifs = await prisma.notification.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log(notifs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
