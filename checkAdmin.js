const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@bpm.uz' } });
  if (!admin) {
    console.log("Admin topilmadi!");
    return;
  }
  const isMatch = await bcrypt.compare('Admin123!', admin.password);
  console.log("Admin email:", admin.email);
  console.log("Admin123! paroli mosmi?:", isMatch);
  
  // What if password is 'password123'?
  const isMatch2 = await bcrypt.compare('password123', admin.password);
  console.log("password123 paroli mosmi?:", isMatch2);
}

main().catch(console.error).finally(() => prisma.$disconnect());
