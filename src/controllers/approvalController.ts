import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { workflowService } from '../services/workflowService';

// GET /api/approvals/my — Mening kutayotgan tasdiqlashlarim
export const getMyPendingApprovals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';

    if (isAdmin) {
      // Admin: barcha IN_APPROVAL holatidagi hujjatlarni ko'radi
      const documents = await prisma.document.findMany({
        where: { status: 'IN_APPROVAL' },
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { select: { id: true, fullName: true, email: true, department: true } },
          executor: { select: { id: true, fullName: true, department: true } },
          approvalSteps: {
            orderBy: { stepOrder: 'asc' },
            include: { approver: { select: { id: true, fullName: true, email: true, department: true } } },
          },
        },
      });
      sendSuccess(res, documents, 'Barcha kutayotgan hujjatlar');
      return;
    }

    // Oddiy foydalanuvchi: faqat o'ziga tegishli PENDING bosqichlar
    const steps = await prisma.approvalStep.findMany({
      where: {
        approverId: req.user!.userId,
        stepStatus: 'PENDING',
      },
      orderBy: { stepDeadline: 'asc' },
      include: {
        document: {
          include: {
            creator: { select: { id: true, fullName: true, email: true, department: true } },
          },
        },
      },
    });

    sendSuccess(res, steps, 'Kutayotgan tasdiqlashlar');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/approvals/history — Mening tasdiqlash tarixi / Admin: Barcha faol hujjatlar
export const getMyApprovalHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';

    if (isAdmin) {
      // Admin: IN_APPROVAL, IN_EXECUTION va APPROVED holatidagi BARCHA hujjatlar
      const documents = await prisma.document.findMany({
        where: { status: { in: ['IN_APPROVAL', 'IN_EXECUTION', 'APPROVED'] } },
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { select: { id: true, fullName: true, email: true, department: true } },
          executor: { select: { id: true, fullName: true, department: true } },
          approvalSteps: {
            orderBy: { stepOrder: 'asc' },
            include: { approver: { select: { id: true, fullName: true, email: true, department: true } } },
          },
        },
      });
      sendSuccess(res, documents, 'Barcha faol hujjatlar');
      return;
    }

    // Oddiy foydalanuvchi: faqat o'ziga tegishli qatnashgan hujjatlar
    const steps = await prisma.approvalStep.findMany({
      where: {
        approverId: req.user!.userId,
        stepStatus: { in: ['APPROVED', 'REJECTED', 'EXPIRED'] },
        document: {
          status: { in: ['IN_APPROVAL', 'IN_EXECUTION'] },
        },
      },
      orderBy: { actionDate: 'desc' },
      include: {
        document: {
          include: {
            creator: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });

    sendSuccess(res, steps, 'Tasdiqlash tarixi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/approvals/tabs — Tasdiqlashda, Tasdiqlangan, Ijroda
export const getApprovalTabs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';
    const userId = req.user!.userId;

    const docInclude = {
      creator: { select: { id: true, fullName: true, email: true, department: true } },
      executor: { select: { id: true, fullName: true, email: true, department: true } },
      approvalSteps: {
        orderBy: { stepOrder: 'asc' as const },
        include: {
          approver: { select: { id: true, fullName: true, email: true, department: true } },
        },
      },
      _count: { select: { history: true } },
    };

    // 1. Tasdiqlashda (IN_APPROVAL)
    const inApprovalWhere = isAdmin
      ? { status: 'IN_APPROVAL' }
      : {
          status: 'IN_APPROVAL',
          OR: [
            { approvalSteps: { some: { approverId: userId } } },
            { executorId: userId },
            { creatorId: userId },
          ],
        };

    // 2. Tasdiqlangan (APPROVED)
    const approvedWhere = isAdmin
      ? { status: 'APPROVED' }
      : {
          status: 'APPROVED',
          OR: [
            { approvalSteps: { some: { approverId: userId } } },
            { executorId: userId },
            { creatorId: userId },
          ],
        };

    // 3. Ijroda (IN_EXECUTION)
    const inExecutionWhere = isAdmin
      ? { status: 'IN_EXECUTION' }
      : {
          status: 'IN_EXECUTION',
          OR: [
            { executorId: userId },
            { approvalSteps: { some: { approverId: userId } } },
            { creatorId: userId },
          ],
        };

    // 4. Yakunlangan (COMPLETED)
    const completedWhere = isAdmin
      ? { status: 'COMPLETED' }
      : {
          status: 'COMPLETED',
          OR: [
            { executorId: userId },
            { approvalSteps: { some: { approverId: userId } } },
            { creatorId: userId },
          ],
        };

    const [inApproval, approved, inExecution, completed] = await Promise.all([
      prisma.document.findMany({
        where: inApprovalWhere,
        orderBy: { updatedAt: 'desc' },
        include: docInclude,
      }),
      prisma.document.findMany({
        where: approvedWhere,
        orderBy: { updatedAt: 'desc' },
        include: docInclude,
      }),
      prisma.document.findMany({
        where: inExecutionWhere,
        orderBy: { updatedAt: 'desc' },
        include: docInclude,
      }),
      prisma.document.findMany({
        where: completedWhere,
        orderBy: { updatedAt: 'desc' },
        include: docInclude,
      }),
    ]);

    sendSuccess(res, {
      inApproval,
      approved,
      inExecution,
      completed,
    }, "Tasdiqlash bo'limlari ro'yxati");
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/approvals/:stepId/approve — Tasdiqlash
export const approveStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stepId } = req.params;
    const { comment } = req.body;

    const step = await prisma.approvalStep.findUnique({
      where: { id: parseInt(stepId) },
      include: { document: true },
    });

    if (!step) {
      sendError(res, 'Tasdiqlash bosqichi topilmadi', 404);
      return;
    }

    if (step.approverId !== req.user!.userId) {
      sendError(res, 'Bu bosqichni tasdiqlash uchun ruxsat yo\'q', 403);
      return;
    }

    if (step.stepStatus !== 'PENDING') {
      sendError(res, 'Bu bosqich allaqachon qayta ishlangan', 400);
      return;
    }

    if (step.document.status !== 'IN_APPROVAL') {
      if (step.document.status === 'EXPIRED' && (!step.stepDeadline || new Date(step.stepDeadline) > new Date())) {
        await prisma.document.update({
          where: { id: step.documentId },
          data: { status: 'IN_APPROVAL' },
        });
      } else {
        sendError(res, 'Hujjat tasdiqlash jarayonida emas', 400);
        return;
      }
    }

    const currentActiveStep = await prisma.approvalStep.findFirst({
      where: { documentId: step.documentId, stepStatus: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
    });

    if (currentActiveStep && currentActiveStep.id !== step.id) {
      sendError(res, 'Tasdiqlash navbati hali sizga yetib kelmagan', 400);
      return;
    }

    const result = await workflowService.approveStep(step.id, step.documentId, comment, req.user!.userId);
    sendSuccess(res, result, 'Hujjat bosqichi tasdiqlandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/approvals/:stepId/reject — Rad etish
export const rejectStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stepId } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length < 10) {
      sendError(res, 'Rad etish uchun izoh (kamida 10 ta belgi) talab etiladi', 400);
      return;
    }

    const step = await prisma.approvalStep.findUnique({
      where: { id: parseInt(stepId) },
      include: { document: true },
    });

    if (!step) {
      sendError(res, 'Tasdiqlash bosqichi topilmadi', 404);
      return;
    }

    if (step.approverId !== req.user!.userId) {
      sendError(res, 'Bu bosqichni rad etish uchun ruxsat yo\'q', 403);
      return;
    }

    if (step.stepStatus !== 'PENDING') {
      sendError(res, 'Bu bosqich allaqachon qayta ishlangan', 400);
      return;
    }

    const result = await workflowService.rejectStep(step.id, step.documentId, comment, req.user!.userId);
    sendSuccess(res, result, 'Hujjat bosqichi rad etildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};
