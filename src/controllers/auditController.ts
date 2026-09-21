import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';

// GET /api/admin/audit-log
export const getAuditLog = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = '1',
      limit = '20',
      userId,
      actionName,
      dateFrom,
      dateTo,
      search,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};

    if (userId) {
      where.performedById = parseInt(userId as string);
    }

    if (actionName) {
      where.actionName = actionName as string;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom as string) } : {}),
        ...(dateTo ? { lte: new Date(new Date(dateTo as string).setHours(23, 59, 59, 999)) } : {}),
      };
    }

    if (search) {
      where.OR = [
        { description: { contains: search as string } },
        { actionName: { contains: search as string } },
        { performedBy: { fullName: { contains: search as string } } },
        { document: { title: { contains: search as string } } },
        { document: { docNumber: { contains: search as string } } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.taskHistory.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          performedBy: {
            select: { id: true, fullName: true, email: true, department: true, role: true },
          },
          document: {
            select: { id: true, docNumber: true, title: true, docType: true, status: true },
          },
        },
      }),
      prisma.taskHistory.count({ where }),
    ]);

    sendSuccess(res, logs, 'Audit log', 200, {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/admin/audit-log/actions — mavjud amal turlari ro'yxati
export const getAuditActionTypes = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actions = await prisma.taskHistory.groupBy({
      by: ['actionName'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    sendSuccess(res, actions.map(a => ({ action: a.actionName, count: a._count.id })), 'Amal turlari');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/admin/users/:id/activity — xodimning faoliyat tarixi
export const getUserActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.userId);
    const { page = '1', limit = '15' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, role: true, department: true, isActive: true },
    });

    if (!user) {
      sendError(res, 'Foydalanuvchi topilmadi', 404);
      return;
    }

    const [logs, total, docStats] = await Promise.all([
      prisma.taskHistory.findMany({
        where: { performedById: userId },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          document: {
            select: { id: true, docNumber: true, title: true, docType: true, status: true },
          },
        },
      }),
      prisma.taskHistory.count({ where: { performedById: userId } }),
      prisma.taskHistory.groupBy({
        by: ['actionName'],
        where: { performedById: userId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    sendSuccess(res, {
      user,
      logs,
      actionStats: docStats.map(d => ({ action: d.actionName, count: d._count.id })),
    }, 'Foydalanuvchi faoliyat tarixi', 200, {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};
