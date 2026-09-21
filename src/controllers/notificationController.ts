import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';

// GET /api/notifications — Mening bildirishnomalarim
export const getMyNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.userId },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          document: { select: { id: true, docNumber: true, title: true } },
        },
      }),
      prisma.notification.count({ where: { userId: req.user!.userId } }),
      prisma.notification.count({ where: { userId: req.user!.userId, isRead: false } }),
    ]);

    sendSuccess(res, { notifications, unreadCount }, 'Bildirishnomalar', 200, {
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

// PATCH /api/notifications/:id/read
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.notification.updateMany({
      where: { id: parseInt(id), userId: req.user!.userId },
      data: { isRead: true },
    });

    sendSuccess(res, null, 'Bildirishnoma o\'qildi deb belgilandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/notifications/read-all
export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, isRead: false },
      data: { isRead: true },
    });

    sendSuccess(res, null, 'Barcha bildirishnomalar o\'qildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// DELETE /api/notifications/clear — Barcha bildirishnomalarni tozalash
export const clearAllNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.deleteMany({
      where: { userId: req.user!.userId },
    });

    sendSuccess(res, null, 'Barcha bildirishnomalar tozalandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};
