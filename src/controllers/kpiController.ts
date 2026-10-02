import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';

// KPI hisoblash yordamchi funksiyasi (4 xil Svetofor mantiqi asosida)
async function calcKpiForUser(userId: number) {
  const createdDocs = await prisma.document.count({ where: { creatorId: userId } });
  const rejectedDocsAsCreator = await prisma.document.count({
    where: { creatorId: userId, status: 'REJECTED' }
  });

  const now = Date.now();

  // 1. Tasdiqlovchi (Approver) ko'rsatkichlari
  const approvalSteps = await prisma.approvalStep.findMany({
    where: { approverId: userId },
    select: { stepStatus: true, stepDeadline: true, actionDate: true }
  });

  let onTimeApprovals = 0;     // O'z vaqtida tasdiqlangan
  let lateApprovals = 0;       // Kechikib tasdiqlangan
  let overdueApprovals = 0;    // Muddati o'tgan, tasdiqlanmagan
  let inProgressApprovals = 0; // Ijroda, muddat bor hali

  approvalSteps.forEach(step => {
    const isActed = step.stepStatus !== 'PENDING';
    const hasDeadline = !!step.stepDeadline;

    if (hasDeadline && step.stepDeadline) {
      const deadlineDate = new Date(step.stepDeadline);
      const deadlineTime = deadlineDate.getTime();

      if (isActed) {
        const actionTime = step.actionDate ? new Date(step.actionDate).getTime() : now;
        if (actionTime <= deadlineTime) {
          onTimeApprovals++;
        } else {
          lateApprovals++;
        }
      } else {
        if (now > deadlineTime || step.stepStatus === 'EXPIRED') {
          overdueApprovals++;
        } else {
          inProgressApprovals++;
        }
      }
    } else {
      if (isActed) {
        onTimeApprovals++;
      } else {
        inProgressApprovals++;
      }
    }
  });

  const totalApprovals = onTimeApprovals + lateApprovals;
  const evaluatedApprovals = onTimeApprovals + lateApprovals + overdueApprovals;
  const approverRate = evaluatedApprovals > 0
    ? Math.round(((onTimeApprovals * 100 + lateApprovals * 50) / evaluatedApprovals))
    : 100;

  // 2. Ijrochi (Executor) ko'rsatkichlari — 4 xil Svetofor qoidalari:
  // - Yashil: Berilgan muddat davomida ijro yakunlangan
  // - Sariq: Ijro yakunlangan, faqat kechikib ijro qilingan
  // - Qizil: Muddat tugagan va ijro bajarilmagan
  // - Oq: Ijroda, muddat bor hali
  const executorDocs = await prisma.document.findMany({
    where: { executorId: userId },
    select: { status: true, overallDeadline: true, completedAt: true }
  });

  let greenCount = 0;   // YASHIL: Berilgan muddat davomida ijro yakunlangan
  let yellowCount = 0;  // SARIQ: Ijro yakunlangan, faqat kechikib ijro qilingan
  let redCount = 0;     // QIZIL: Muddat tugagan va ijro bajarilmagan
  let whiteCount = 0;   // OQ: Ijroda, muddat bor hali

  executorDocs.forEach(doc => {
    const isCompleted = doc.status === 'COMPLETED';
    const hasDeadline = !!doc.overallDeadline;

    if (hasDeadline && doc.overallDeadline) {
      const deadlineDate = new Date(doc.overallDeadline);
      const deadlineTime = deadlineDate.getTime();

      if (isCompleted) {
        const completedTime = doc.completedAt ? new Date(doc.completedAt).getTime() : now;
        if (completedTime <= deadlineTime) {
          greenCount++; // YASHIL: Berilgan muddat davomida ijro yakunlangan
        } else {
          yellowCount++; // SARIQ: Ijro yakunlangan, faqat kechikib ijro qilingan
        }
      } else {
        if (now > deadlineTime || doc.status === 'EXPIRED') {
          redCount++; // QIZIL: Muddat tugagan va ijro bajarilmagan
        } else {
          whiteCount++; // OQ: Ijroda, muddat bor hali
        }
      }
    } else {
      if (isCompleted) {
        greenCount++; // YASHIL
      } else {
        whiteCount++; // OQ
      }
    }
  });

  const totalExecutions = greenCount + yellowCount;
  const evaluatedExecutions = greenCount + yellowCount + redCount;
  // O'z vaqtida bajarish 100%, Kechikib bajarilgan (Sariq) 50% hisoblanadi, Qizil (bajarilmagan) 0%
  const executorRate = evaluatedExecutions > 0
    ? Math.round(((greenCount * 100 + yellowCount * 50) / evaluatedExecutions))
    : 100;

  const creatorRate = createdDocs > 0 ? Math.round(((createdDocs - rejectedDocsAsCreator) / createdDocs) * 100) : 100;

  const hasApprover = evaluatedApprovals > 0;
  const hasExecutor = evaluatedExecutions > 0;
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
      overdue: overdueApprovals,
      inProgress: inProgressApprovals,
      onTimeRate: approverRate
    },
    executor: {
      totalExecutions,
      onTime: greenCount,
      late: yellowCount,
      overdue: redCount,
      inProgress: whiteCount,
      onTimeRate: executorRate
    },
    trafficBreakdown: {
      green: greenCount,
      yellow: yellowCount,
      red: redCount,
      white: whiteCount,
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
