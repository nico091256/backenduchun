import { prisma } from '../utils/prisma';
import { emailService } from './emailService';
import { config } from '../config';

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
        executor: { select: { id: true, fullName: true, email: true, department: true } },
        coExecutors: { include: { user: { select: { id: true, fullName: true, email: true, department: true } } } },
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

      // Mas'ul ijrochiga bildirishnoma hamda Email xabarnoma yuborish
      if (document.executorId) {
        await this.sendNotification(
          document.executorId,
          documentId,
          'APPROVAL_REQUEST',
          'Yangi topshiriq ijroga kelib tushdi! 🚀',
          `"${document.title}" hujjati to'g'ridan-to'g'ri ijro etishingiz uchun yo'naltirildi.`
        );

        if (existingDoc.executor && existingDoc.executor.email) {
          emailService.sendTaskAssignedEmail({
            toEmail: existingDoc.executor.email,
            executorName: existingDoc.executor.fullName,
            docNumber: existingDoc.docNumber,
            docTitle: existingDoc.title,
            deadline: existingDoc.overallDeadline
              ? new Date(existingDoc.overallDeadline).toLocaleDateString('uz-UZ')
              : undefined,
            resolution: existingDoc.resolution || undefined,
            docId: existingDoc.id,
          }).catch((mailErr) => console.error('Failed to send task assigned email:', mailErr));
        }
      }

      // Ham-ijrochilarga ham bildirishnoma va Email yuborish
      if (existingDoc.coExecutors && existingDoc.coExecutors.length > 0) {
        for (const ce of existingDoc.coExecutors) {
          await this.sendNotification(
            ce.userId,
            documentId,
            'APPROVAL_REQUEST',
            'Ham-ijrochi sifatida topshiriq biriktirildi! 👥',
            `"${existingDoc.title}" hujjatiga ham-ijrochi sifatida biriktirildingiz.`
          );

          if (ce.user?.email) {
            emailService.sendTaskAssignedEmail({
              toEmail: ce.user.email,
              executorName: ce.user.fullName,
              docNumber: existingDoc.docNumber,
              docTitle: existingDoc.title,
              deadline: existingDoc.overallDeadline
                ? new Date(existingDoc.overallDeadline).toLocaleDateString('uz-UZ')
                : undefined,
              resolution: existingDoc.resolution || undefined,
              docId: existingDoc.id,
            }).catch((mailErr) => console.error('Failed to send task assigned email to co-executor:', mailErr));
          }
        }
      }

      // Faqat boshqa shaxs yuborgan bo'lsa yaratuvchiga bildirishnoma beriladi
      if (document.creatorId !== userId) {
        await this.sendNotification(
          document.creatorId,
          documentId,
          'APPROVED',
          'Hujjat ijroga yo\'naltirildi! 🚀',
          `"${document.title}" hujjati to'g'ridan-to'g'ri ijro holatiga o'tkazildi.`
        );
      }

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

    // Birinchi bosqichdagi BARCHA (shu jumladan parallel) tasdiqlovchilarga bildirishnoma yuborish
    if (document.approvalSteps.length > 0) {
      const firstStepOrder = document.approvalSteps[0].stepOrder;
      const activeFirstSteps = document.approvalSteps.filter((s) => s.stepOrder === firstStepOrder);

      for (const step of activeFirstSteps) {
        await this.sendNotification(
          step.approverId,
          documentId,
          'APPROVAL_REQUEST',
          'Yangi tasdiqlash so\'rovi',
          `"${document.title}" hujjati sizning tasdiqlashingizni kutmoqda.`
        );

        if (step.approver && (step.approver as any).email) {
          emailService.sendApprovalRequestEmail({
            toEmail: (step.approver as any).email,
            approverName: (step.approver as any).fullName,
            docNumber: document.docNumber,
            docTitle: document.title,
            creatorName: document.creator?.fullName || 'Xodim',
            docId: document.id,
            deadline: step.stepDeadline ? new Date(step.stepDeadline).toLocaleDateString('uz-UZ') : undefined,
          }).catch((err) => console.error('Failed to send approval request email:', err));
        }
      }
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

    const currentStep = await prisma.approvalStep.findUnique({
      where: { id: stepId },
      include: { approver: { select: { fullName: true, department: true } } },
    });
    if (!currentStep) throw new Error('Step not found');

    // 1. Shu bosqich (stepOrder) da hali PENDING bo'lib turgan boshqa parallel tasdiqlovchilar bormi?
    const remainingInSameOrder = await prisma.approvalStep.findMany({
      where: {
        documentId,
        stepOrder: currentStep.stepOrder,
        stepStatus: 'PENDING',
      },
      include: { approver: true },
    });

    if (remainingInSameOrder.length > 0) {
      // Parallel bosqich hali to'liq yakunlanmagan (qolgan ham-tasdiqlovchilar kutilmoqda)
      await prisma.taskHistory.create({
        data: {
          documentId,
          actionName: `APPROVED_STEP_${currentStep.stepOrder}`,
          description: `${currentStep.stepOrder}-bosqichda ${currentStep.approver?.fullName || 'Tasdiqlovchi'} tasdiqladi (qolgan ${remainingInSameOrder.length} ta tasdiqlovchi kutilmoqda)${comment ? '. Izoh: ' + comment : ''}`,
          performedById: userId,
        },
      });
      return currentStep;
    }

    // 2. Ushbu stepOrder to'liq tasdiqlandi. Keyingi navbatdagi PENDING stepOrder qidiramiz
    let nextStep = await prisma.approvalStep.findFirst({
      where: {
        documentId,
        stepOrder: { gt: currentStep.stepOrder },
        stepStatus: 'PENDING',
      },
      orderBy: { stepOrder: 'asc' },
      include: { approver: true },
    });

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        creator: { select: { id: true, fullName: true, department: true } },
        executor: { select: { id: true, fullName: true, department: true } },
      },
    });
    if (!document) throw new Error('Document not found');

    if (nextStep) {
      // Keyingi bosqichdagi BARCHA parallel tasdiqlovchilarga bildirishnoma yuborish
      const nextOrderSteps = await prisma.approvalStep.findMany({
        where: {
          documentId,
          stepOrder: nextStep.stepOrder,
          stepStatus: 'PENDING',
        },
        include: { approver: true },
      });

      for (const ns of nextOrderSteps) {
        await this.sendNotification(
          ns.approverId,
          documentId,
          'APPROVAL_REQUEST',
          'Yangi tasdiqlash so\'rovi',
          `"${document.title}" hujjati ${currentStep.stepOrder}-bosqichdan o'tdi. Sizning tasdiqlashingizni kutmoqda.`
        );

        if (ns.approver?.email) {
          emailService.sendApprovalRequestEmail({
            toEmail: ns.approver.email,
            approverName: ns.approver.fullName,
            docNumber: document.docNumber,
            docTitle: document.title,
            creatorName: document.creator?.fullName || 'Xodim',
            docId: document.id,
            deadline: ns.stepDeadline ? new Date(ns.stepDeadline).toLocaleDateString('uz-UZ') : undefined,
          }).catch(err => console.error('Failed to send email to next approver:', err));
        }
      }

      // Tarixga yozish
      await prisma.taskHistory.create({
        data: {
          documentId,
          actionName: `APPROVED_STEP_${currentStep.stepOrder}`,
          description: `${currentStep.stepOrder}-bosqich to'liq tasdiqlandi. ${nextStep.stepOrder}-bosqichga o'tdi${comment ? '. Izoh: ' + comment : ''}`,
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



      // Ijrochiga bildirishnoma va Email xabarnoma (hujjat ijroga o'tganda)
      const docWithExec = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          executor: { select: { fullName: true, email: true } },
          coExecutors: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        },
      });

      if (document.executorId) {
        await this.sendNotification(
          document.executorId,
          documentId,
          'APPROVAL_REQUEST',
          'Hujjat tasdiqlandi — Ijro kutilmoqda! 📥',
          `"${document.title}" hujjati barcha bosqichlardan o'tdi. Ijroni boshlashingiz mumkin.`
        );

        if (docWithExec?.executor?.email) {
          emailService.sendTaskAssignedEmail({
            toEmail: docWithExec.executor.email,
            executorName: docWithExec.executor.fullName,
            docNumber: docWithExec.docNumber,
            docTitle: docWithExec.title,
            deadline: docWithExec.overallDeadline
              ? new Date(docWithExec.overallDeadline).toLocaleDateString('uz-UZ')
              : undefined,
            resolution: docWithExec.resolution || undefined,
            docId: docWithExec.id,
          }).catch((mailErr) => console.error('Failed to send task assigned email:', mailErr));
        }
      }

      // Ham-ijrochilarga ham bildirishnoma va Email yuborish
      if (docWithExec?.coExecutors && docWithExec.coExecutors.length > 0) {
        for (const ce of docWithExec.coExecutors) {
          await this.sendNotification(
            ce.userId,
            documentId,
            'APPROVAL_REQUEST',
            'Hujjat tasdiqlandi — Ham-ijro kutilmoqda! 📥',
            `"${document.title}" hujjati barcha bosqichlardan o'tdi. Ham-ijrochi sifatida ishtirok etishingiz mumkin.`
          );

          if (ce.user?.email) {
            emailService.sendTaskAssignedEmail({
              toEmail: ce.user.email,
              executorName: ce.user.fullName,
              docNumber: docWithExec.docNumber,
              docTitle: docWithExec.title,
              deadline: docWithExec.overallDeadline
                ? new Date(docWithExec.overallDeadline).toLocaleDateString('uz-UZ')
                : undefined,
              resolution: docWithExec.resolution || undefined,
              docId: docWithExec.id,
            }).catch((mailErr) => console.error('Failed to send task assigned email to co-executor:', mailErr));
          }
        }
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

  // Bosqichni qayta ishlashga qaytarish (Return for Revision)
  async returnStepForRevision(stepId: number, documentId: number, comment: string, userId: number) {
    await prisma.approvalStep.update({
      where: { id: stepId },
      data: {
        stepStatus: 'RETURNED_FOR_REVISION',
        comment,
        actionDate: new Date(),
      },
    });

    const currentStep = await prisma.approvalStep.findUnique({
      where: { id: stepId },
      include: { approver: { select: { fullName: true, department: true } } },
    });
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { creator: { select: { email: true, fullName: true } } },
    });

    if (!document) throw new Error('Document not found');

    // Qolgan kutilayotgan bosqichlarni SKIPPED qilish
    await prisma.approvalStep.updateMany({
      where: { documentId, stepStatus: 'PENDING' },
      data: { stepStatus: 'SKIPPED' },
    });

    // Hujjatni RETURNED_FOR_REVISION holatiga o'tkazish
    const updatedDoc = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'RETURNED_FOR_REVISION',
        history: {
          create: {
            actionName: `RETURNED_FOR_REVISION_STEP_${currentStep?.stepOrder}`,
            description: `${currentStep?.stepOrder}-bosqichda qayta ishlashga qaytarildi. Sabab: ${comment}`,
            performedById: userId,
          },
        },
      },
    });

    // Hujjat egasiga in-app bildirishnoma
    await this.sendNotification(
      document.creatorId,
      documentId,
      'REVISION_REQUEST',
      'Hujjat qayta ishlashga qaytarildi 📝',
      `"${document.title}" hujjati qayta ishlashga qaytarildi. Sabab: ${comment}`
    );

    // Email bildirishnoma
    if (document.creator?.email) {
      emailService.sendEmail({
        to: document.creator.email,
        subject: `[BPM] Hujjat qayta ishlashga qaytarildi: "${document.title}"`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #D97706; margin-top: 0;">📝 Hujjat qayta ishlashga qaytarildi</h2>
            <p>Hurmatli <strong>${document.creator.fullName}</strong>,</p>
            <p>Siz yaratgan <strong>"${document.title}"</strong> hujjati tasdiqlovchi tomonidan kamchiliklarni bartaraf etish uchun qaytarildi.</p>
            <div style="background: #FFFBEB; border-left: 4px solid #F59E0B; padding: 12px; margin: 15px 0; border-radius: 4px;">
              <strong>Qaytaruvchi:</strong> ${currentStep?.approver?.fullName || 'Tasdiqlovchi'}<br/>
              <strong>Izoh / Sabab:</strong> ${comment}
            </div>
            <p>Iltimos, ko'rsatilgan kamchiliklarni to'g'rilab, hujjatni qayta tasdiqlashga yuboring.</p>
            <p><a href="${config.frontendUrl}/dashboard/documents/${documentId}" style="display: inline-block; background: #D97706; color: #fff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold;">Hujjatni ochish va tahrirlash</a></p>
          </div>
        `,
      }).catch(err => console.error('Failed to send revision email:', err));
    }

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

    // Bog'langan barcha topshiriqlarni ham avtomatik COMPLETED holatiga o'tkazish
    try {
      const linkedTasks = await prisma.task.findMany({
        where: { documentId, status: { not: 'COMPLETED' } },
      });

      for (const t of linkedTasks) {
        await prisma.task.update({
          where: { id: t.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            resultNote: executionNote,
            ...(fileData && {
              resultFileUrl: fileData.fileUrl,
              resultFileName: fileData.fileName,
              resultFileSize: fileData.fileSize,
            }),
          },
        });

        await prisma.taskActivity.create({
          data: {
            taskId: t.id,
            action: 'COMPLETED',
            description: `Hujjat ijrosi yakunlangani sababli topshiriq ham avtomatik ravishda yakunlandi: ${executionNote.slice(0, 100)}`,
            performedById: userId,
          },
        });
      }
    } catch (e) {
      console.error('Error synchronizing linked tasks on executeDocument:', e);
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
