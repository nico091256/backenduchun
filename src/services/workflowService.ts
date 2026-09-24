import { prisma } from '../utils/prisma';

class WorkflowService {
  // Hujjatni tasdiqlashga yoki to'g'ridan-to'g'ri ijroga yuborish
  async submitDocument(documentId: number, userId: number) {
    const existingDoc = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        approvalSteps: {
          orderBy: { stepOrder: 'asc' },
          include: { approver: true },
        },
        creator: { select: { id: true, fullName: true, department: true } },
        executor: { select: { id: true, fullName: true, department: true } },
      },
    });

    if (!existingDoc) throw new Error('Document not found');

    // Agar tasdiqlovchilar belgilanmagan bo'lsa — to'g'ridan-to'g'ri IN_EXECUTION ga o'tadi
    if (!existingDoc.approvalSteps || existingDoc.approvalSteps.length === 0) {
      const document = await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'IN_EXECUTION',
          submittedAt: new Date(),
          history: {
            create: {
              actionName: 'DIRECT_EXECUTION',
              description: 'Tasdiqlovchilarsiz to\'g\'ridan-to\'g\'ri ijroga yo\'naltirildi',
              performedById: userId,
            },
          },
        },
        include: {
          approvalSteps: true,
          creator: { select: { fullName: true, department: true } },
        },
      });

      // Mas'ul ijrochiga bildirishnoma
      if (document.executorId && document.executorId !== userId) {
        await this.sendNotification(
          document.executorId,
          documentId,
          'APPROVAL_REQUEST',
          'Yangi topshiriq ijroga kelib tushdi! 🚀',
          `"${document.title}" hujjati to'g'ridan-to'g'ri ijro etishingiz uchun yo'naltirildi.`
        );


      }

      // Hujjat yaratuvchisiga bildirishnoma
      await this.sendNotification(
        document.creatorId,
        documentId,
        'APPROVED',
        'Hujjat ijroga yo\'naltirildi! 🚀',
        `"${document.title}" hujjati to'g'ridan-to'g'ri ijro holatiga o'tkazildi.`
      );

      return document;
    }

    // Tasdiqlash bosqichlari mavjud bo'lsa — IN_APPROVAL
    const document = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'IN_APPROVAL',
        submittedAt: new Date(),
        history: {
          create: {
            actionName: 'SUBMITTED',
            description: 'Hujjat tasdiqlashga yuborildi',
            performedById: userId,
          },
        },
      },
      include: {
        approvalSteps: {
          orderBy: { stepOrder: 'asc' },
          include: { approver: true },
        },
        creator: { select: { fullName: true, department: true } },
      },
    });

    // Birinchi bosqichdagi tasdiqlovchiga bildirishnoma yuborish
    const firstStep = document.approvalSteps[0];
    const totalSteps = document.approvalSteps.length;

    if (firstStep) {
      await this.sendNotification(
        firstStep.approverId,
        documentId,
        'APPROVAL_REQUEST',
        'Yangi tasdiqlash so\'rovi',
        `"${document.title}" hujjati sizning tasdiqlashingizni kutmoqda.`
      );


    }

    return document;
  }

  // Bosqichni tasdiqlash
  async approveStep(stepId: number, documentId: number, comment: string | undefined, userId: number) {
    // Joriy bosqichni tasdiqlash
    await prisma.approvalStep.update({
      where: { id: stepId },
      data: {
        stepStatus: 'APPROVED',
        comment: comment || null,
        actionDate: new Date(),
      },
    });

    // Keyingi navbatdagi PENDING bosqichni qidirish
    const currentStep = await prisma.approvalStep.findUnique({
      where: { id: stepId },
      include: { approver: { select: { fullName: true, department: true } } },
    });
    if (!currentStep) throw new Error('Step not found');

    const totalSteps = await prisma.approvalStep.count({ where: { documentId } });

    // Joriy qadamdan keyingi eng yaqin PENDING qadamni qidiramiz
    let nextStep = await prisma.approvalStep.findFirst({
      where: {
        documentId,
        stepOrder: { gt: currentStep.stepOrder },
        stepStatus: 'PENDING',
      },
      orderBy: { stepOrder: 'asc' },
      include: { approver: true },
    });

    // Agar keyinroq qadam topilmasa, boshqa qolib ketgan PENDING qadamlar bormi-yo'qligini tekshiramiz
    if (!nextStep) {
      nextStep = await prisma.approvalStep.findFirst({
        where: {
          documentId,
          stepStatus: 'PENDING',
        },
        orderBy: { stepOrder: 'asc' },
        include: { approver: true },
      });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        creator: { select: { id: true, fullName: true, department: true } },
        executor: { select: { id: true, fullName: true, department: true } },
      },
    });
    if (!document) throw new Error('Document not found');

    if (nextStep) {
      // Keyingi bosqichga bildirishnoma yuborish
      await this.sendNotification(
        nextStep.approverId,
        documentId,
        'APPROVAL_REQUEST',
        'Yangi tasdiqlash so\'rovi',
        `"${document.title}" hujjati ${currentStep.stepOrder}-bosqichdan o'tdi. Sizning tasdiqlashingizni kutmoqda.`
      );



      // Tarixga yozish
      await prisma.taskHistory.create({
        data: {
          documentId,
          actionName: `APPROVED_STEP_${currentStep.stepOrder}`,
          description: `${currentStep.stepOrder}-bosqich tasdiqlandi${comment ? '. Izoh: ' + comment : ''}`,
          performedById: userId,
        },
      });
    } else {
      // Barcha bosqichlar tasdiqlandi — hujjatni IN_EXECUTION ga o'tkazish
      const updatedDoc = await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'IN_EXECUTION',
          history: {
            create: {
              actionName: 'ALL_APPROVED',
              description: 'Barcha bosqichlar tasdiqlandi. Hujjat ijroga o\'tdi!',
              performedById: userId,
            },
          },
        },
      });

      // Hujjat egasiga bildirishnoma (in-app)
      await this.sendNotification(
        document.creatorId,
        documentId,
        'APPROVED',
        'Hujjat tasdiqlandi — Ijroda! ✅',
        `"${document.title}" hujjati barcha bosqichlardan o'tdi. Endi ijro qilib, javob xatini yuboring.`
      );



      // Ijrochiga bildirishnoma (hujjat ijroga o'tganda)
      if (document.executorId && document.executorId !== document.creatorId) {
        await this.sendNotification(
          document.executorId,
          documentId,
          'APPROVAL_REQUEST',
          'Hujjat tasdiqlandi — Ijro kutilmoqda! 📥',
          `"${document.title}" hujjati barcha bosqichlardan o'tdi. Ijroni boshlashingiz mumkin.`
        );


      }

      return updatedDoc;
    }

    return nextStep;
  }

  // Bosqichni rad etish
  async rejectStep(stepId: number, documentId: number, comment: string, userId: number) {
    await prisma.approvalStep.update({
      where: { id: stepId },
      data: {
        stepStatus: 'REJECTED',
        comment,
        actionDate: new Date(),
      },
    });

    const currentStep = await prisma.approvalStep.findUnique({
      where: { id: stepId },
      include: { approver: { select: { fullName: true, department: true } } },
    });
    const document = await prisma.document.findUnique({ where: { id: documentId } });

    if (!document) throw new Error('Document not found');

    // Barcha kutayotgan bosqichlarni SKIPPED ga o'tkazish
    await prisma.approvalStep.updateMany({
      where: { documentId, stepStatus: 'PENDING' },
      data: { stepStatus: 'SKIPPED' },
    });

    // Hujjatni REJECTED ga o'tkazish
    const updatedDoc = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'REJECTED',
        history: {
          create: {
            actionName: `REJECTED_STEP_${currentStep?.stepOrder}`,
            description: `${currentStep?.stepOrder}-bosqichda rad etildi. Sabab: ${comment}`,
            performedById: userId,
          },
        },
      },
    });

    // Hujjat egasiga in-app bildirishnoma
    await this.sendNotification(
      document.creatorId,
      documentId,
      'REJECTED',
      'Hujjat rad etildi ❌',
      `"${document.title}" hujjati rad etildi. Sabab: ${comment}`
    );



    return updatedDoc;
  }

  // Ijroni yakunlash (Javob hujjati yuborish)
  async executeDocument(
    documentId: number,
    userId: number,
    executionNote: string,
    fileData?: { fileUrl: string; fileName: string; fileSize: number }
  ) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        executor: { select: { fullName: true, department: true } },
      },
    });
    if (!document) throw new Error('Document not found');

    const updatedDoc = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        executionNote,
        ...(fileData
          ? {
              executionFileUrl: fileData.fileUrl,
              executionFileName: fileData.fileName,
            }
          : {}),
        history: {
          create: {
            actionName: 'EXECUTED',
            description: `Ijro yakunlandi. Izoh: ${executionNote}`,
            performedById: userId,
          },
        },
      },
    });

    // Ijro faylini DocumentAttachment jadvaliga ham saqlash (hujjatlar bo'limida ko'rinishi uchun)
    if (fileData) {
      await prisma.documentAttachment.create({
        data: {
          documentId,
          fileUrl: fileData.fileUrl,
          fileName: fileData.fileName,
          fileSize: fileData.fileSize,
          fileType: 'EXECUTION',
          uploadedById: userId,
        },
      });
    }

    // Hujjat egasiga in-app bildirishnoma
    if (document.creatorId !== userId) {
      await this.sendNotification(
        document.creatorId,
        documentId,
        'APPROVED',
        'Javob hujjati keldi! 📨',
        `"${document.title}" bo'yicha ijro yakunlandi va javob hujjati yuborildi.`
      );


    }

    return updatedDoc;
  }

  // Bildirishnoma yuborish (in-app + WebSocket)
  private async sendNotification(
    userId: number,
    documentId: number,
    type: string,
    title: string,
    message: string
  ) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        documentId,
        type,
        title,
        message,
        link: `/dashboard/documents/${documentId}`,
      },
    });

    try {
      // Real-time socket bildirishnoma
      const { sendSocketNotification } = require('../server');
      sendSocketNotification(userId, notification);
    } catch {
      // socket fallback
    }
  }
}

export const workflowService = new WorkflowService();
