import { prisma } from '../utils/prisma';
import { OFFICIAL_DEPARTMENTS } from '../utils/departmentsData';

async function sync() {
  console.log('🔄 Rasmiy bo\'limlar ma\'lumotlarini sinxronizatsiya qilish boshlandi...');

  for (const dept of OFFICIAL_DEPARTMENTS) {
    const existing = await prisma.department.findFirst({
      where: {
        OR: [
          { code: dept.code },
          { name: dept.name },
        ],
      },
    });

    if (existing) {
      await prisma.department.update({
        where: { id: existing.id },
        data: {
          code: dept.code,
          name: dept.name,
          description: dept.description,
        },
      });
      console.log(`  ✅ Yangilandi: [${dept.code}] ${dept.name}`);
    } else {
      await prisma.department.create({
        data: {
          code: dept.code,
          name: dept.name,
          description: dept.description,
        },
      });
      console.log(`  ➕ Yaratildi: [${dept.code}] ${dept.name}`);
    }
  }

  // Eski noaniq bo'limlarni tozalash (agar kerak bo'lsa)
  const allDepts = await prisma.department.findMany();
  for (const d of allDepts) {
    if (!OFFICIAL_DEPARTMENTS.some(od => od.code === d.code || od.name === d.name)) {
      console.log(`  ⚠️  Eski bo'lim aniqlandi: [${d.code}] ${d.name}`);
    }
  }

  console.log('✨ Bo\'limlar sinxronizatsiyasi muvaffaqiyatli yakunlandi!');
}

sync()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
