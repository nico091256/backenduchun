const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('123456', 12);
  const admin = await prisma.user.update({
    where: { email: 'admin@bpm.uz' },
    data: { password }
  });
  console.log("Password updated for", admin.email);
}

main().catch(console.error).finally(() => prisma.$disconnect());
