import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { workflowService } from '../services/workflowService';

// PATCH /api/admin/documents/:id/deadline
export const updateDocumentDeadline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { deadline } = req.body;

    if (!deadline) {
      sendError(res, 'Yangi muddat (deadline) kiritilishi shart', 400);
      return;
    }

    const docId = parseInt(id);
    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: { approvalSteps: true },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    const newDate = new Date(deadline);
    const isFuture = newDate > new Date();
    const shouldReactivate = document.status === 'EXPIRED' && isFuture;

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        overallDeadline: newDate,
        ...(shouldReactivate ? { status: 'IN_APPROVAL' } : {}),
      },
    });

    // Hujjat qayta faollashtirilsa, EXPIRED qadamlarni ham PENDING qilamiz
    if (shouldReactivate) {
      await prisma.approvalStep.updateMany({
        where: {
          documentId: docId,
          stepStatus: 'EXPIRED',
        },
        data: {
          stepStatus: 'PENDING',
          stepDeadline: newDate,
        },
      });
    }

    await prisma.taskHistory.create({
      data: {
        documentId: docId,
        actionName: 'DEADLINE_EXTENDED',
        description: `Umumiy muddat ${newDate.toLocaleDateString('uz-UZ')} gacha uzaytirildi${shouldReactivate ? " va hujjat qayta faollashtirildi" : ""}`,
        performedById: req.user!.userId,
      },
    });

    sendSuccess(res, updated, 'Hujjat muddati muvaffaqiyatli uzaytirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/admin/steps/:stepId/deadline
export const updateStepDeadline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stepId } = req.params;
    const { deadline } = req.body;

    if (!deadline) {
      sendError(res, 'Yangi muddat (deadline) kiritilishi shart', 400);
      return;
    }

    const sId = parseInt(stepId);
    const step = await prisma.approvalStep.findUnique({
      where: { id: sId },
      include: { document: true },
    });

    if (!step) {
      sendError(res, 'Tasdiqlash bosqichi topilmadi', 404);
      return;
    }

    const newDate = new Date(deadline);
    const isFuture = newDate > new Date();

    const updated = await prisma.approvalStep.update({
      where: { id: sId },
      data: {
        stepDeadline: newDate,
        ...(step.stepStatus === 'EXPIRED' && isFuture ? { stepStatus: 'PENDING' } : {}),
      },
    });

    // MUHIM: Hujjatning umumiy muddati ushbu qadam muddatidan kichik bo'lsa yoki hujjat EXPIRED bo'lsa,
    // umumiy muddatni ham yangilaymiz va hujjatni IN_APPROVAL holatiga qaytaramiz!
    const doc = step.document;
    const needDocDeadlineUpdate = !doc.overallDeadline || doc.overallDeadline < newDate;
    const needDocReactivate = doc.status === 'EXPIRED' && isFuture;

    if (needDocDeadlineUpdate || needDocReactivate) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          ...(needDocDeadlineUpdate ? { overallDeadline: newDate } : {}),
          ...(needDocReactivate ? { status: 'IN_APPROVAL' } : {}),
        },
      });
    }

    await prisma.taskHistory.create({
      data: {
        documentId: doc.id,
        actionName: 'STEP_DEADLINE_EXTENDED',
        description: `${step.stepOrder}-bosqich muddati ${newDate.toLocaleDateString('uz-UZ')} gacha uzaytirildi`,
        performedById: req.user!.userId,
      },
    });

    sendSuccess(res, updated, 'Tasdiqlash muddati muvaffaqiyatli uzaytirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/admin/steps/:stepId/reassign
export const reassignStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stepId } = req.params;
    const { newApproverId } = req.body;

    if (!newApproverId) {
      sendError(res, 'Yangi tasdiqlovchi (newApproverId) kiritilishi shart', 400);
      return;
    }

    const sId = parseInt(stepId);
    const step = await prisma.approvalStep.findUnique({
      where: { id: sId },
      include: { document: true },
    });

    if (!step) {
      sendError(res, 'Tasdiqlash bosqichi topilmadi', 404);
      return;
    }

    const nextApproverId = parseInt(newApproverId);
    const newApprover = await prisma.user.findUnique({ where: { id: nextApproverId } });
    if (!newApprover) {
      sendError(res, 'Yangi tasdiqlovchi topilmadi', 404);
      return;
    }

    const now = new Date();
    let stepDeadline = step.stepDeadline;
    if (!stepDeadline || stepDeadline < now) {
      stepDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // kamida +3 kun
    }

    // 1. Qadamni yangi tasdiqlovchiga o'tkazish va PENDING qilish
    const updated = await prisma.approvalStep.update({
      where: { id: sId },
      data: {
        approverId: nextApproverId,
        stepStatus: 'PENDING',
        comment: null,
        actionDate: null,
        stepDeadline: stepDeadline,
      },
      include: { approver: true },
    });

    // 2. Agar hujjat EXPIRED bo'lsa yoki umumiy muddat o'tib ketgan bo'lsa, uni ham qayta faollashtiramiz
    const doc = step.document;
    const needDocDeadlineUpdate = !doc.overallDeadline || doc.overallDeadline < stepDeadline;
    const needDocReactivate = doc.status === 'EXPIRED';

    if (needDocDeadlineUpdate || needDocReactivate) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          ...(needDocDeadlineUpdate ? { overallDeadline: stepDeadline } : {}),
          ...(needDocReactivate ? { status: 'IN_APPROVAL' } : {}),
        },
      });
    }

    // 3. Bildirishnoma yuborish
    await prisma.notification.create({
      data: {
        userId: nextApproverId,
        documentId: doc.id,
        type: 'APPROVAL_REQUEST',
        title: 'Yangi tasdiqlash vazifasi biriktirildi',
        message: `"${doc.title}" hujjati bo'yicha ${step.stepOrder}-bosqich tasdiqlash vazifasi sizga biriktirildi.`,
        link: `/dashboard/documents/${doc.id}`,
      },
    });

    await prisma.taskHistory.create({
      data: {
        documentId: doc.id,
        actionName: 'STEP_REASSIGNED',
        description: `${step.stepOrder}-bosqich tasdiqlovchisi ${newApprover.fullName} ga o'zgartirildi`,
        performedById: req.user!.userId,
      },
    });

    sendSuccess(res, updated, 'Tasdiqlovchi muvaffaqiyatli o\'zgartirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/admin/steps/:stepId/force-approve
export const forceApproveStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stepId } = req.params;
    const sId = parseInt(stepId);

    const step = await prisma.approvalStep.findUnique({
      where: { id: sId },
      include: { document: true },
    });

    if (!step) {
      sendError(res, 'Tasdiqlash bosqichi topilmadi', 404);
      return;
    }

    if (step.stepStatus !== 'PENDING') {
      sendError(res, 'Bu bosqich allaqachon qayta ishlangan', 400);
      return;
    }

    // Agar hujjat EXPIRED bo'lsa, admin tasdiqlay olishi uchun avval uni IN_APPROVAL qilamiz
    if (step.document.status === 'EXPIRED') {
      await prisma.document.update({
        where: { id: step.documentId },
        data: { status: 'IN_APPROVAL' },
      });
    }

    const comment = 'Tizim ma\'muri tomonidan majburiy tasdiqlandi (Force Approve)';
    const result = await workflowService.approveStep(step.id, step.documentId, comment, req.user!.userId);

    sendSuccess(res, result, 'Bosqich admin tomonidan majburiy tasdiqlandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/admin/documents/:id/cancel
export const cancelDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({ where: { id: docId } });
    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (['COMPLETED', 'REJECTED', 'DRAFT'].includes(document.status)) {
      sendError(res, 'Bu holatdagi hujjatni bekor qilib bo\'lmaydi', 400);
      return;
    }

    await prisma.approvalStep.updateMany({
      where: { documentId: docId, stepStatus: 'PENDING' },
      data: { stepStatus: 'SKIPPED' }
    });

    const updated = await prisma.document.update({
      where: { id: docId },
      data: { 
        status: 'REJECTED',
        history: {
          create: {
            actionName: 'ADMIN_CANCEL',
            description: 'Tizim ma\'muri tomonidan jarayon bekor qilindi (Revoked)',
            performedById: req.user!.userId
          }
        }
      }
    });

    sendSuccess(res, updated, 'Hujjat jarayoni bekor qilindi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/admin/documents/:id/rollback-to-approval
export const rollbackDocumentToApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: {
        approvalSteps: {
          orderBy: { stepOrder: 'asc' },
          include: { approver: true },
        },
      },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    // Hujjat holatini IN_APPROVAL ga qaytarish
    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        status: 'IN_APPROVAL',
        history: {
          create: {
            actionName: 'ROLLBACK_TO_APPROVAL',
            description: 'Tizim ma\'muri tomonidan hujjat qaytadan tasdiqlash bosqichiga qaytarildi',
            performedById: req.user!.userId,
          },
        },
      },
    });

    // Agar hech qaysi qadam PENDING bo'lmasa, oxirgi qadamni PENDING ga o'tkazamiz
    const hasPending = document.approvalSteps.some((s) => s.stepStatus === 'PENDING');
    if (!hasPending && document.approvalSteps.length > 0) {
      const lastStep = document.approvalSteps[document.approvalSteps.length - 1];
      await prisma.approvalStep.update({
        where: { id: lastStep.id },
        data: { stepStatus: 'PENDING', actionDate: null },
      });
    }

    sendSuccess(res, updated, 'Hujjat muvaffaqiyatli tasdiqlash jarayoniga qaytarildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};
