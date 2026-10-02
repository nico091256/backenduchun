const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hash123456 = await bcrypt.hash('123456', 12);
  const hashAdmin123 = await bcrypt.hash('Admin123!', 12);

  const admin1 = await prisma.user.upsert({
    where: { email: 'admin@bpm.uz' },
    update: { password: hash123456, isActive: true, role: 'ADMIN' },
    create: {
      fullName: 'BPM Administrator',
      email: 'admin@bpm.uz',
      password: hash123456,
      role: 'ADMIN',
      department: 'IT Boshqarmasi',
      position: 'Bosh Administrator',
      phone: '+998901234567',
      isActive: true,
    },
  });
  console.log('✅ admin@bpm.uz ready:', admin1.email, 'password: 123456');

  const admin2 = await prisma.user.upsert({
    where: { email: 'admin@di.uz' },
    update: { password: hashAdmin123, isActive: true, role: 'ADMIN' },
    create: {
      fullName: 'DI Administrator',
      email: 'admin@di.uz',
      password: hashAdmin123,
      role: 'ADMIN',
      department: 'IT Boshqarmasi',
      position: 'Administrator',
      phone: '+998907654321',
      isActive: true,
    },
  });
  console.log('✅ admin@di.uz ready:', admin2.email, 'password: Admin123!');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
