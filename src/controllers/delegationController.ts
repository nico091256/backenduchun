import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';

// GET /api/delegations
export const getMyDelegations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const [given, received] = await Promise.all([
      prisma.delegation.findMany({
        where: { delegatorId: userId },
        orderBy: { createdAt: 'desc' },
        include: {
          delegate: { select: { id: true, fullName: true, email: true, department: true, position: true } },
        },
      }),
      prisma.delegation.findMany({
        where: { delegateId: userId, isActive: true },
        orderBy: { startDate: 'desc' },
        include: {
          delegator: { select: { id: true, fullName: true, email: true, department: true, position: true } },
        },
      }),
    ]);

    sendSuccess(res, { given, received }, 'Vakolatlar ro\'yxati');
  } catch (err) {
    console.error('Delegations fetch error:', err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/delegations
export const createDelegation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { delegateId, startDate, endDate, reason } = req.body;

    if (!delegateId || !endDate) {
      sendError(res, 'O\'rinbosar xodim va yakunlanish sanasi talab etiladi', 400);
      return;
    }

    if (Number(delegateId) === userId) {
      sendError(res, 'O\'zingizga vakolat topshira olmaysiz', 400);
      return;
    }

    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(endDate);

    if (isNaN(end.getTime()) || end < start) {
      sendError(res, 'Yakunlanish sanasi boshlanish sanasidan keyin bo\'lishi shart', 400);
      return;
    }

    // Eski faol delegatsiyalarni yakunlash
    await prisma.delegation.updateMany({
      where: { delegatorId: userId, isActive: true },
      data: { isActive: false },
    });

    const delegation = await prisma.delegation.create({
      data: {
        delegatorId: userId,
        delegateId: Number(delegateId),
        startDate: start,
        endDate: end,
        reason: reason?.trim() || 'Mehnat ta\'tili / Xizmat safari',
        isActive: true,
      },
      include: {
        delegate: { select: { id: true, fullName: true, email: true, department: true } },
      },
    });

    // In-app Notification to Delegate
    try {
      await prisma.notification.create({
        data: {
          userId: Number(delegateId),
          type: 'DELEGATION_ASSIGNED',
          title: '🛡️ Vakolat topshirildi',
          message: `${req.user!.email} tomonidan ${end.toLocaleDateString('uz-UZ')} gacha hujjatlarni tasdiqlash vakolati topshirildi.`,
          link: '/dashboard/approvals',
        },
      });
    } catch (notifErr) {
      console.error('Notification error:', notifErr);
    }

    sendCreated(res, delegation, 'Vakolat muvaffaqiyatli topshirildi');
  } catch (err: any) {
    console.error('Delegation create error:', err);
    sendError(res, err?.message || 'Vakolat topshirishda xatolik', 500);
  }
};

// PATCH /api/delegations/:id/cancel
export const cancelDelegation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const delegation = await prisma.delegation.findUnique({
      where: { id: Number(id) },
    });

    if (!delegation) {
      sendError(res, 'Vakolat topilmadi', 404);
      return;
    }

    if (delegation.delegatorId !== userId && req.user!.role !== 'ADMIN') {
      sendError(res, 'Ruxsat berilmagan', 403);
      return;
    }

    const updated = await prisma.delegation.update({
      where: { id: Number(id) },
      data: { isActive: false },
    });

    sendSuccess(res, updated, 'Vakolat muvaffaqiyatli bekor qilindi');
  } catch (err) {
    console.error('Delegation cancel error:', err);
    sendError(res, 'Server xatosi', 500);
  }
};
