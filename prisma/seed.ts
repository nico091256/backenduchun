import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Hash password
  const password = await bcrypt.hash('Admin123!', 12);

  // 1. Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@bpm.uz' },
    update: {},
    create: {
      fullName: 'Tizim Administratori',
      email: 'admin@bpm.uz',
      password,
      role: 'ADMIN',
      department: 'IT Bo\'limi',
      position: 'Tizim Administratori',
      phone: '+998901234567',
    },
  });

  // 2. Initiator (Tashabbuskor)
  const initiator = await prisma.user.upsert({
    where: { email: 'initiator@bpm.uz' },
    update: {},
    create: {
      fullName: 'Alisher Toshmatov',
      email: 'initiator@bpm.uz',
      password,
      role: 'INITIATOR',
      department: 'Moliya Bo\'limi',
      position: 'Bosh Moliyachi',
      phone: '+998901234568',
    },
  });

  // 3. Approver 1
  const approver1 = await prisma.user.upsert({
    where: { email: 'approver1@bpm.uz' },
    update: {},
    create: {
      fullName: 'Dilnoza Yusupova',
      email: 'approver1@bpm.uz',
      password,
      role: 'APPROVER',
      department: 'Huquq Bo\'limi',
      position: 'Yurist',
      phone: '+998901234569',
    },
  });

  // 4. Approver 2
  const approver2 = await prisma.user.upsert({
    where: { email: 'approver2@bpm.uz' },
    update: {},
    create: {
      fullName: 'Bobur Karimov',
      email: 'approver2@bpm.uz',
      password,
      role: 'APPROVER',
      department: 'Rahbariyat',
      position: 'Direktor O\'rinbosari',
      phone: '+998901234570',
    },
  });

  // 5. Executor (Ijrochi)
  const executor = await prisma.user.upsert({
    where: { email: 'executor@bpm.uz' },
    update: {},
    create: {
      fullName: 'Sardor Rahimov',
      email: 'executor@bpm.uz',
      password,
      role: 'EXECUTOR',
      department: 'Texnik Bo\'lim',
      position: 'Muhandis',
      phone: '+998901234571',
    },
  });

  console.log('✅ Users created:', { admin, initiator, approver1, approver2, executor });

  // Demo hujjat
  const doc = await prisma.document.create({
    data: {
      docNumber: 'BPM-2024-0001',
      title: 'Yangi server xarid qilish to\'g\'risida buyurtma',
      description: 'IT bo\'limi uchun 2 ta yangi server kompyuter sotib olish zaruriyati. Texnik talablar: 32GB RAM, 2TB SSD, Xeon protsessor.',
      category: 'Jihoz so\'rovi',
      priority: 'HIGH',
      status: 'IN_APPROVAL',
      overallDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 kun
      creatorId: initiator.id,
      submittedAt: new Date(),
    },
  });

  // Approval chain
  await prisma.approvalStep.createMany({
    data: [
      {
        documentId: doc.id,
        stepOrder: 1,
        approverId: approver1.id,
        stepStatus: 'PENDING',
        stepDeadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 kun
      },
      {
        documentId: doc.id,
        stepOrder: 2,
        approverId: approver2.id,
        stepStatus: 'PENDING',
        stepDeadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 kun
      },
    ],
  });

  // History
  await prisma.taskHistory.create({
    data: {
      documentId: doc.id,
      actionName: 'CREATED',
      description: 'Hujjat yaratildi va tasdiqlashga yuborildi',
      performedById: initiator.id,
    },
  });

  // Notification (approver1 uchun)
  await prisma.notification.create({
    data: {
      userId: approver1.id,
      documentId: doc.id,
      type: 'APPROVAL_REQUEST',
      title: 'Yangi tasdiqlash so\'rovi',
      message: `"${doc.title}" hujjati sizning tasdiqlashingizni kutmoqda.`,
      link: `/documents/${doc.id}`,
    },
  });

  console.log('✅ Demo document created:', doc.docNumber);
  console.log('\n📧 Login ma\'lumotlari:');
  console.log('  Admin:     admin@bpm.uz     | Admin123!');
  console.log('  Initiator: initiator@bpm.uz | Admin123!');
  console.log('  Approver1: approver1@bpm.uz | Admin123!');
  console.log('  Approver2: approver2@bpm.uz | Admin123!');
  console.log('  Executor:  executor@bpm.uz  | Admin123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
