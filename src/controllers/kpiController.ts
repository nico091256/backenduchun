import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';

// KPI hisoblash yordamchi funksiyasi
async function calcKpiForUser(userId: number) {
  const createdDocs = await prisma.document.count({ where: { creatorId: userId } });
  const rejectedDocsAsCreator = await prisma.document.count({
    where: { creatorId: userId, status: 'REJECTED' }
  });

  const approvalSteps = await prisma.approvalStep.findMany({
    where: { approverId: userId, stepStatus: { not: 'PENDING' } },
    select: { stepStatus: true, stepDeadline: true, actionDate: true }
  });

  let onTimeApprovals = 0;
  let lateApprovals = 0;
  const totalApprovals = approvalSteps.length;

  approvalSteps.forEach(step => {
    if (step.stepDeadline && step.actionDate) {
      if (new Date(step.actionDate) <= new Date(step.stepDeadline)) {
        onTimeApprovals++;
      } else {
        lateApprovals++;
      }
    } else {
      onTimeApprovals++;
    }
  });

  const executorDocs = await prisma.document.findMany({
    where: { executorId: userId, status: 'COMPLETED' },
    select: { overallDeadline: true, completedAt: true }
  });

  let onTimeExecutions = 0;
  let lateExecutions = 0;
  const totalExecutions = executorDocs.length;

  executorDocs.forEach(doc => {
    if (doc.overallDeadline && doc.completedAt) {
      if (new Date(doc.completedAt) <= new Date(doc.overallDeadline)) {
        onTimeExecutions++;
      } else {
        lateExecutions++;
      }
    } else {
      onTimeExecutions++;
    }
  });

  const creatorRate = createdDocs > 0 ? Math.round(((createdDocs - rejectedDocsAsCreator) / createdDocs) * 100) : 100;
  const approverRate = totalApprovals > 0 ? Math.round((onTimeApprovals / totalApprovals) * 100) : 100;
  const executorRate = totalExecutions > 0 ? Math.round((onTimeExecutions / totalExecutions) * 100) : 100;
  
  const hasApprover = totalApprovals > 0;
  const hasExecutor = totalExecutions > 0;
  let overallRate = 100;

  if (hasApprover && hasExecutor) {
    overallRate = Math.round((approverRate + executorRate) / 2);
  } else if (hasApprover) {
    overallRate = approverRate;
  } else if (hasExecutor) {
    overallRate = executorRate;
  }

  return {
    creator: {
      totalCreated: createdDocs,
      totalRejected: rejectedDocsAsCreator,
      successRate: creatorRate
    },
    approver: {
      totalSteps: totalApprovals,
      onTime: onTimeApprovals,
      late: lateApprovals,
      onTimeRate: approverRate
    },
    executor: {
      totalExecutions,
      onTime: onTimeExecutions,
      late: lateExecutions,
      onTimeRate: executorRate
    },
    overallRate
  };
}

// GET /api/kpi/personal
export const getPersonalKPI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const kpiData = await calcKpiForUser(userId);
    sendSuccess(res, kpiData, 'Shaxsiy KPI ko\'rsatkichlari', 200);
  } catch (err) {
    console.error('getPersonalKPI Error:', err);
    sendError(res, 'KPI ma\'lumotlarini olishda xatolik', 500);
  }
};

// GET /api/kpi/user/:userId — Admin: bitta xodimning KPI si
export const getUserKPI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { sendError(res, 'Noto\'g\'ri userId', 400); return; }

    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, role: true, department: true, position: true, isActive: true }
    });
    if (!userRecord) { sendError(res, 'Foydalanuvchi topilmadi', 404); return; }

    const kpiData = await calcKpiForUser(userId);
    sendSuccess(res, { user: userRecord, kpi: kpiData }, 'Xodim KPI ko\'rsatkichlari', 200);
  } catch (err) {
    console.error('getUserKPI Error:', err);
    sendError(res, 'KPI ma\'lumotlarini olishda xatolik', 500);
  }
};

// GET /api/kpi/users — Admin: barcha xodimlar KPI reytingi
export const getAllUsersKPI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, email: true, role: true, department: true, position: true, isActive: true }
    });

    const results = await Promise.all(
      users.map(async (u) => {
        const kpi = await calcKpiForUser(u.id);
        return { user: u, kpi };
      })
    );

    // Umumiy KPI foizi bo'yicha kamayish tartibida saralash
    results.sort((a, b) => b.kpi.overallRate - a.kpi.overallRate);

    sendSuccess(res, results, 'Barcha xodimlar KPI reytingi', 200);
  } catch (err) {
    console.error('getAllUsersKPI Error:', err);
    sendError(res, 'KPI ma\'lumotlarini olishda xatolik', 500);
  }
};
