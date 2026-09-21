import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Demo account emaillar ro'yxati — bularni o'chiramiz
const DEMO_EMAILS = [
  'initiator@bpm.uz',
  'approver1@bpm.uz',
  'approver2@bpm.uz',
  'executor@bpm.uz',
  'admin@bpm.uz', // eski admin ham o'chiriladi, yangi yaratiladi
];

async function main() {
  console.log('🧹 Demo accountlarni tozalash boshlandi...');

  // 1. Demo accountlarga bog'liq barcha ma'lumotlarni ketma-ket o'chiramiz
  // (referential integrity sababli tartib muhim)
  for (const email of DEMO_EMAILS) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;

    // Foydalanuvchiga tegishli notification, refreshToken va boshqalarni o'chirish
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    // Approval steps (bu user approver bo'lgan hujjatlarni topamiz)
    const steps = await prisma.approvalStep.findMany({ where: { approverId: user.id }, select: { documentId: true } });
    const docIds = steps.map(s => s.documentId);

    if (docIds.length > 0) {
      // Ushbu hujjatlarga bog'liq barcha ma'lumotlarni o'chirish
      await prisma.notification.deleteMany({ where: { documentId: { in: docIds } } });
      await prisma.taskHistory.deleteMany({ where: { documentId: { in: docIds } } });
      await prisma.approvalStep.deleteMany({ where: { documentId: { in: docIds } } });
      await prisma.document.deleteMany({ where: { id: { in: docIds } } });
    }

    // Foydalanuvchi yaratgan hujjatlarni ham o'chirish
    const createdDocs = await prisma.document.findMany({ where: { creatorId: user.id }, select: { id: true } });
    const createdDocIds = createdDocs.map(d => d.id);
    if (createdDocIds.length > 0) {
      await prisma.notification.deleteMany({ where: { documentId: { in: createdDocIds } } });
      await prisma.taskHistory.deleteMany({ where: { documentId: { in: createdDocIds } } });
      await prisma.approvalStep.deleteMany({ where: { documentId: { in: createdDocIds } } });
      await prisma.document.deleteMany({ where: { id: { in: createdDocIds } } });
    }

    await prisma.taskHistory.deleteMany({ where: { performedById: user.id } });
    await prisma.approvalStep.deleteMany({ where: { approverId: user.id } });

    await prisma.user.delete({ where: { email } });
    console.log(`   🗑️  Demo account o'chirildi: ${email}`);
  }

  console.log('\n✅ Barcha demo accountlar muvaffaqiyatli o\'chirildi.');

  // 2. Yagona haqiqiy Admin hisobini yaratish
  console.log('\n🔐 Haqiqiy Admin hisobi yaratilmoqda...');

  const adminPassword = await bcrypt.hash('DiscoverBPM@2025', 14);

  const admin = await prisma.user.create({
    data: {
      fullName: 'Bosh Administrator',
      email: 'superadmin@discover.uz',
      password: adminPassword,
      role: 'ADMIN',
      department: 'IT Boshqarmasi',
      position: 'Tizim Bosh Administratori',
      phone: '+998901234567',
      isActive: true,
    },
  });

  console.log('\n════════════════════════════════════════════');
  console.log('  ✅ Haqiqiy Admin hisobi muvaffaqiyatli yaratildi!');
  console.log('════════════════════════════════════════════');
  console.log(`  📧 Email   : ${admin.email}`);
  console.log('  🔑 Parol   : DiscoverBPM@2025');
  console.log(`  👤 Ism     : ${admin.fullName}`);
  console.log(`  🆔 ID      : ${admin.id}`);
  console.log('════════════════════════════════════════════');
  console.log('  ⚠️  Parolni tizimga kirgandan keyin o\'zgartiring!');
  console.log('════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed xatolik:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
