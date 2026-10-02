import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { io } from '../server';

// GET /api/documents/:id/comments — Hujjat bo'yicha barcha izohlar
export const getDocumentComments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const documentId = parseInt(id, 10);

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        coExecutors: true,
        approvalSteps: true,
      },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    // Access check: ADMIN or creator, executor, coExecutor, approver
    if (req.user!.role !== 'ADMIN') {
      const isParticipant =
        document.creatorId === req.user!.userId ||
        document.executorId === req.user!.userId ||
        document.coExecutors.some((c) => c.userId === req.user!.userId) ||
        document.approvalSteps.some((a) => a.approverId === req.user!.userId);

      if (!isParticipant) {
        sendError(res, 'Ushbu hujjat muhokamasini ko\'rish uchun ruxsat yo\'q', 403);
        return;
      }
    }

    const comments = await prisma.documentComment.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            department: true,
            position: true,
            role: true,
          },
        },
      },
    });

    sendSuccess(res, comments, 'Izohlar ro\'yxati');
  } catch (err) {
    console.error('Error fetching comments:', err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/documents/:id/comments — Yangi izoh qo'shish
export const createDocumentComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const documentId = parseInt(id, 10);
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      sendError(res, 'Izoh matni bo\'sh bo\'lishi mumkin emas', 400);
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        creator: true,
        executor: true,
        coExecutors: true,
        approvalSteps: true,
      },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    // Access check
    if (req.user!.role !== 'ADMIN') {
      const isParticipant =
        document.creatorId === req.user!.userId ||
        document.executorId === req.user!.userId ||
        document.coExecutors.some((c) => c.userId === req.user!.userId) ||
        document.approvalSteps.some((a) => a.approverId === req.user!.userId);

      if (!isParticipant) {
        sendError(res, 'Ushbu hujjatga izoh qoldirish uchun ruxsat yo\'q', 403);
        return;
      }
    }

    const comment = await prisma.documentComment.create({
      data: {
        documentId,
        userId: req.user!.userId,
        content: content.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            department: true,
            position: true,
            role: true,
          },
        },
      },
    });

    // Ishtirokchilarni aniqlash va bildirishnoma yuborish
    const participantIds = new Set<number>();
    if (document.creatorId !== req.user!.userId) participantIds.add(document.creatorId);
    if (document.executorId && document.executorId !== req.user!.userId) participantIds.add(document.executorId);
    document.coExecutors.forEach((c) => {
      if (c.userId !== req.user!.userId) participantIds.add(c.userId);
    });
    document.approvalSteps.forEach((s) => {
      if (s.approverId !== req.user!.userId) participantIds.add(s.approverId);
    });

    for (const pId of Array.from(participantIds)) {
      await prisma.notification.create({
        data: {
          userId: pId,
          documentId,
          type: 'DOCUMENT_COMMENT',
          title: 'Hujjatda yangi izoh 💬',
          message: `${comment.user.fullName}: "${content.trim().slice(0, 80)}${content.length > 80 ? '...' : ''}"`,
          link: `/dashboard/documents/${documentId}`,
        },
      });

      // Socket orqali xabar uzatish
      io.to(`user:${pId}`).emit('notification', {
        type: 'DOCUMENT_COMMENT',
        title: 'Hujjatda yangi izoh 💬',
        documentId,
      });
    }

    sendCreated(res, comment, 'Izoh muvaffaqiyatli qo\'shildi');
  } catch (err) {
    console.error('Error creating comment:', err);
    sendError(res, 'Server xatosi', 500);
  }
};

// DELETE /api/documents/:id/comments/:commentId — Izohni o'chirish
export const deleteDocumentComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { commentId } = req.params;
    const cId = parseInt(commentId, 10);

    const comment = await prisma.documentComment.findUnique({
      where: { id: cId },
    });

    if (!comment) {
      sendError(res, 'Izoh topilmadi', 404);
      return;
    }

    if (comment.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      sendError(res, 'Bu izohni o\'chirish uchun ruxsat yo\'q', 403);
      return;
    }

    await prisma.documentComment.delete({ where: { id: cId } });
    sendSuccess(res, null, 'Izoh o\'chirildi');
  } catch (err) {
    console.error('Error deleting comment:', err);
    sendError(res, 'Server xatosi', 500);
  }
};
