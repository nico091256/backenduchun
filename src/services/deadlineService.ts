import cron from 'node-cron';
import { prisma } from '../utils/prisma';

class DeadlineService {
  start() {
    console.log('⏰ Deadline monitoring started...');

    // Har 1 soatda bir tekshirish
    cron.schedule('0 * * * *', async () => {
      await this.checkDeadlines();
    });

    // Dastlabki tekshirishni ham hozir bajaramiz
    this.checkDeadlines();
  }

  private async checkDeadlines() {
    const now = new Date();

    try {
      // 1. Muddati o'tgan approval step'larni EXPIRED qilish (Faqat hali jarayonda bo'lgan hujjatlar uchun)
      const expiredSteps = await prisma.approvalStep.findMany({
        where: {
          stepStatus: 'PENDING',
          stepDeadline: { lt: now },
          document: {
            status: { in: ['IN_APPROVAL', 'IN_EXECUTION'] },
          },
        },
        include: {
          document: { select: { id: true, title: true, creatorId: true, docNumber: true } },
          approver: { select: { id: true, fullName: true } },
        },
      });

      for (const step of expiredSteps) {
        await prisma.approvalStep.update({
          where: { id: step.id },
          data: { stepStatus: 'EXPIRED' },
        });

        // Tarixga yozish
        await prisma.taskHistory.create({
          data: {
            documentId: step.documentId,
            actionName: `EXPIRED_STEP_${step.stepOrder}`,
            description: `${step.stepOrder}-bosqich muddati o'tdi. Tasdiqlovchi: ${step.approver.fullName}`,
          },
        });

        // Hujjat egasiga bildirishnoma
        await prisma.notification.create({
          data: {
            userId: step.document.creatorId,
            documentId: step.documentId,
            type: 'DEADLINE_EXPIRED',
            title: 'Bosqich muddati o\'tdi ⚠️',
            message: `"${step.document.title}" hujjatining ${step.stepOrder}-bosqichi muddati o'tdi.`,
            link: `/dashboard/documents/${step.documentId}`,
          },
        });

        // Tasdiqlovchiga ham bildirishnoma
        await prisma.notification.create({
          data: {
            userId: step.approverId,
            documentId: step.documentId,
            type: 'DEADLINE_EXPIRED',
            title: 'Tasdiqlash muddatingiz o\'tdi ⚠️',
            message: `"${step.document.title}" hujjatini tasdiqlash muddati o'tdi.`,
            link: `/dashboard/documents/${step.documentId}`,
          },
        });

      }

      // 2. Umumiy muddati o'tgan hujjatlarni EXPIRED qilish
      // Faqat tasdiqlashda (IN_APPROVAL) yoki ijroda (IN_EXECUTION) bo'lgan hujjatlar muddati o'tgan hisoblanadi
      const expiredDocs = await prisma.document.findMany({
        where: {
          status: { in: ['IN_APPROVAL', 'IN_EXECUTION'] },
          overallDeadline: { lt: now },
        },
      });

      for (const doc of expiredDocs) {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            status: 'EXPIRED',
            history: {
              create: {
                actionName: 'OVERALL_EXPIRED',
                description: 'Umumiy muddat o\'tdi. Hujjat muddati o\'tgan holatiga o\'tkazildi.',
              },
            },
          },
        });

        // Hujjat egasiga bildirishnoma
        await prisma.notification.create({
          data: {
            userId: doc.creatorId,
            documentId: doc.id,
            type: 'OVERALL_DEADLINE_EXPIRED',
            title: 'Hujjat muddati tugadi ❌',
            message: `"${doc.title}" hujjatining umumiy muddati o'tdi.`,
            link: `/dashboard/documents/${doc.id}`,
          },
        });


        // Agar mas'ul ijrochi bo'lsa va u yaratuvchining o'zi bo'lmasa, ijrochiga ham bildirishnoma
        if (doc.executorId && doc.executorId !== doc.creatorId) {
          await prisma.notification.create({
            data: {
              userId: doc.executorId,
              documentId: doc.id,
              type: 'OVERALL_DEADLINE_EXPIRED',
              title: 'Ijro muddatingiz tugadi ⚠️',
              message: `"${doc.title}" hujjatining ijro muddati tugadi.`,
              link: `/dashboard/documents/${doc.id}`,
            },
          });

        }
      }

      // 3. 24 soat ichida muddati tugaydigan bosqichlarga eslatma
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const soonExpiring = await prisma.approvalStep.findMany({
        where: {
          stepStatus: 'PENDING',
          reminderSent: false,
          stepDeadline: { gte: now, lte: tomorrow },
        },
        include: {
          document: { select: { id: true, title: true, docNumber: true } },
        },
      });

      for (const step of soonExpiring) {
        await prisma.notification.create({
          data: {
            userId: step.approverId,
            documentId: step.documentId,
            type: 'DEADLINE_WARNING',
            title: 'Tasdiqlash muddati tugayapti ⏰',
            message: `"${step.document.title}" hujjatini tasdiqlash muddati 24 soat ichida tugaydi.`,
            link: `/dashboard/documents/${step.documentId}`,
          },
        });


        await prisma.approvalStep.update({
          where: { id: step.id },
          data: { reminderSent: true },
        });
      }

      if (expiredSteps.length > 0 || expiredDocs.length > 0 || soonExpiring.length > 0) {
        console.log(
          `⏰ Deadline check: ${expiredSteps.length} steps expired, ${expiredDocs.length} docs expired, ${soonExpiring.length} reminders sent`
        );
      }
    } catch (err) {
      console.error('❌ Deadline check error:', err);
    }
  }
}

export const deadlineService = new DeadlineService();
