import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { telegramService } from '../services/telegramService';
import { emailService } from '../services/emailService';
import { incomingEmailService } from '../services/incomingEmailService';

export class IncomingEmailController {
  /**
   * Get all incoming emails / documents
   * GET /api/incoming-emails
   */
  public async getIncomingEmails(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status, page = '1', limit = '20', search } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const whereClause: any = {
        docType: 'INCOMING',
      };

      if (status && status !== 'ALL') {
        whereClause.status = status as string;
      }

      if (search) {
        whereClause.OR = [
          { title: { contains: search as string } },
          { docNumber: { contains: search as string } },
          { senderOrg: { contains: search as string } },
          { description: { contains: search as string } },
        ];
      }

      const [total, documents] = await Promise.all([
        prisma.document.count({ where: whereClause }),
        prisma.document.findMany({
          where: whereClause,
          include: {
            creator: { select: { id: true, fullName: true, email: true, department: true } },
            executor: { select: { id: true, fullName: true, email: true, department: true } },
            attachments: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
        }),
      ]);

      const totalPages = Math.ceil(total / limitNum);

      sendSuccess(res, documents, 'Kiruvchi xatlar muvaffaqiyatli olindi', 200, {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      });
    } catch (error) {
      console.error('Error fetching incoming emails:', error);
      sendError(res, 'Kiruvchi xatlarini olishda xatolik yuz berdi');
    }
  }

  /**
   * Assign incoming email to executor and set deadline / resolution
   * POST /api/incoming-emails/:id/assign
   */
  public async assignIncomingEmail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const docId = parseInt(req.params.id, 10);
      const { executorId, overallDeadline, resolution, priority } = req.body;

      if (!executorId) {
        sendError(res, "Mas'ul ijrochini (executorId) tanlash majburiy", 400);
        return;
      }

      const existingDoc = await prisma.document.findUnique({
        where: { id: docId },
        include: { executor: true },
      });

      if (!existingDoc) {
        sendError(res, 'Hujjat topilmadi', 404);
        return;
      }

      const executorUser = await prisma.user.findUnique({
        where: { id: parseInt(executorId, 10) },
      });

      if (!executorUser || !executorUser.isActive) {
        sendError(res, "Tanlangan mas'ul ijrochi topilmadi yoki faol emas", 400);
        return;
      }

      const deadlineDate = overallDeadline && typeof overallDeadline === 'string' && overallDeadline.trim()
        ? new Date(overallDeadline)
        : null;
      const validDeadline = deadlineDate && !isNaN(deadlineDate.getTime()) ? deadlineDate : null;

      // Update Document
      const updatedDoc = await prisma.document.update({
        where: { id: docId },
        data: {
          executorId: executorUser.id,
          status: 'IN_EXECUTION',
          resolution: resolution || existingDoc.resolution,
          overallDeadline: validDeadline || existingDoc.overallDeadline,
          priority: priority || existingDoc.priority,
          history: {
            create: {
              actionName: 'ASSIGNED_TO_EXECUTION',
              description: `Kiruvchi email xati ${executorUser.fullName} ga ijro uchun yo'naltirildi. Rezolyutsiya: "${resolution || 'Mavjud emas'}"`,
              performedById: req.user?.userId,
            },
          },
        },
        include: {
          creator: { select: { id: true, fullName: true, department: true } },
          executor: { select: { id: true, fullName: true, email: true, department: true } },
          attachments: true,
        },
      });

      // 1. Create In-App Notification
      try {
        await prisma.notification.create({
          data: {
            userId: executorUser.id,
            type: 'TASK_ASSIGNED',
            title: '📥 Yangi Kiruvchi Topshiriq',
            message: `Sizga "${updatedDoc.title}" (#${updatedDoc.docNumber}) hujjati ijroga biriktirildi.`,
            link: `/dashboard/documents/${updatedDoc.id}`,
            documentId: updatedDoc.id,
          },
        });
      } catch (notifErr) {
        console.error('Failed to create in-app notification:', notifErr);
      }

      // 2. Telegram Notification
      try {
        await telegramService.sendExecutionAssigned(executorUser.id, {
          id: updatedDoc.id,
          title: updatedDoc.title,
          docNumber: updatedDoc.docNumber,
          creatorName: req.user?.email || 'Administrator',
          deadline: updatedDoc.overallDeadline,
        });
      } catch (tgErr) {
        console.error('Failed to send Telegram notification:', tgErr);
      }

      // 3. Email Notification
      if (executorUser.email) {
        try {
          await emailService.sendTaskAssignedEmail({
            toEmail: executorUser.email,
            executorName: executorUser.fullName,
            docNumber: updatedDoc.docNumber,
            docTitle: updatedDoc.title,
            deadline: updatedDoc.overallDeadline
              ? new Date(updatedDoc.overallDeadline).toLocaleDateString('uz-UZ')
              : undefined,
            resolution: resolution || undefined,
            docId: updatedDoc.id,
          });
        } catch (mailErr) {
          console.error('Failed to send Email notification:', mailErr);
        }
      }

      sendSuccess(res, updatedDoc, "Kiruvchi xat ijroga muvaffaqiyatli yo'naltirildi");
    } catch (error: any) {
      console.error('Error assigning incoming email:', error);
      sendError(res, error?.message || "Kiruvchi xatni ijroga yo'naltirishda xatolik yuz berdi", 500);
    }

  }

  /**
   * Manually trigger IMAP sync check
   * POST /api/incoming-emails/sync
   */
  public async triggerSync(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Run background check
      incomingEmailService.checkAllAccounts().catch(err => {
        console.error('Error in manual email sync:', err);
      });

      sendSuccess(res, null, 'Pochta qutilarini tekshirish jarayoni ishga tushirildi');
    } catch (error) {
      console.error('Error triggering sync:', error);
      sendError(res, 'Pochtani sinxronlashda xatolik');
    }
  }
}

export const incomingEmailController = new IncomingEmailController();
