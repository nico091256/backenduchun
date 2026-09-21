const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@bpm.uz' } });
  console.log(admin);
}

main().catch(console.error).finally(() => prisma.$disconnect());
