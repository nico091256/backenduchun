const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('123456', 12);
  await prisma.user.updateMany({ data: { password } });
  console.log("Barcha foydalanuvchilarning paroli 123456 ga o'zgardi");
}

main().catch(console.error).finally(() => prisma.$disconnect());
