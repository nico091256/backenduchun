import { prisma } from '../utils/prisma';

async function main() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  console.log(`🧹 Bugundan oldingi (${startOfToday.toISOString()}) eski xatlarni tozalash...`);

  const oldEmails = await prisma.document.findMany({
    where: {
      OR: [
        { docNumber: { startsWith: 'IN-EMAIL-' }, senderDate: { lt: startOfToday } },
        { category: { startsWith: 'Kiruvchi Email' }, senderDate: { lt: startOfToday } },
      ],
    },
    select: { id: true, docNumber: true, title: true, senderDate: true },
  });

  console.log(`Topildi: ${oldEmails.length} ta eski email xatlari.`);

  if (oldEmails.length > 0) {
    const ids = oldEmails.map((e) => e.id);
    await prisma.notification.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.taskHistory.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.documentAttachment.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.documentComment.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.approvalStep.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.task.deleteMany({ where: { documentId: { in: ids } } });
    const res = await prisma.document.deleteMany({ where: { id: { in: ids } } });
    console.log(`✅ O'chirildi: ${res.count} ta eski email hujjati.`);
  } else {
    console.log(`Hech qanday eski email topilmadi.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
