import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { workflowService } from '../services/workflowService';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// UTF-8 file name encoding fixer for Multer / multipart uploads
const decodeFilename = (name?: string): string => {
  if (!name) return '';
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '').trim();
  } catch {
    return name.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '').trim();
  }
};

const parseSafeDate = (val?: any): Date | undefined => {
  if (!val || typeof val !== 'string' || !val.trim()) return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
};


// GET /api/documents
export const getDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, priority, page = '1', limit = '10', search, docType } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};

    // Xavfsizlik va ruxsatlar bo'yicha filter:
    // ADMIN tashkilotdagi barcha hujjatlarni ko'ra oladi.
    // Boshqa har qanday xodim (Tashabbuskor, Tasdiqlovchi, Ijrochi) faqat o'ziga daxldor hujjatlarni ko'radi:
    // 1. O'zi yaratgan (creatorId)
    // 2. O'zi ijrochi qilib belgilangan (executorId)
    // 3. O'zi tasdiqlash zanjirida bo'lgan (approvalSteps)
    if (req.user!.role !== 'ADMIN') {
      const accessFilter = {
        OR: [
          { creatorId: req.user!.userId },
          { executorId: req.user!.userId },
          { approvalSteps: { some: { approverId: req.user!.userId } } },
        ],
      };
      if (where.AND) {
        (where.AND as unknown[]).push(accessFilter);
      } else {
        where.AND = [accessFilter];
      }
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (docType) where.docType = docType;

    if (search) {
      const searchCondition = {
        OR: [
          { title: { contains: search as string } },
          { docNumber: { contains: search as string } },
          { senderOrg: { contains: search as string } },
          { recipientOrg: { contains: search as string } },
          { senderDocNumber: { contains: search as string } },
        ],
      };
      if (where.AND) {
        (where.AND as unknown[]).push(searchCondition);
      } else {
        where.AND = [searchCondition];
      }
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, fullName: true, email: true, department: true } },
          executor: { select: { id: true, fullName: true, department: true } },
          parentDoc: { select: { id: true, docNumber: true, title: true, docType: true } },
          attachments: {
            select: { id: true, fileName: true, fileUrl: true, fileSize: true, fileType: true },
          },
          approvalSteps: {
            orderBy: { stepOrder: 'asc' },
            include: {
              approver: { select: { id: true, fullName: true, email: true } },
            },
          },
          _count: { select: { history: true, attachments: true, childDocs: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);

    sendSuccess(res, documents, 'Hujjatlar ro\'yxati', 200, {
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

// GET /api/documents/:id
export const getDocumentById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id: parseInt(id) },
      include: {
        creator: { select: { id: true, fullName: true, email: true, department: true, position: true } },
        executor: { select: { id: true, fullName: true, department: true } },
        parentDoc: {
          select: { id: true, docNumber: true, title: true, docType: true, status: true, priority: true },
        },
        childDocs: {
          select: { id: true, docNumber: true, title: true, docType: true, status: true, priority: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
        approvalSteps: {
          orderBy: { stepOrder: 'asc' },
          include: {
            approver: { select: { id: true, fullName: true, email: true, department: true, position: true } },
          },
        },
        history: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedBy: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    // Xavfsizlik tekshiruvi: faqat daxldor shaxslar yoki Admin ko'ra oladi
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';
    const isCreator = document.creatorId === userId;
    const isExecutor = document.executorId === userId;
    const isApprover = document.approvalSteps.some((step) => step.approverId === userId);

    // Agar mas'ul ijrochi hujjatni birinchi marta ochib ko'rayotgan bo'lsa, ko'rilgan vaqtni yozib qo'yamiz
    if (isExecutor && !(document as any).executorViewedAt) {
      const now = new Date();
      await prisma.document.update({
        where: { id: document.id },
        data: { executorViewedAt: now } as any,
      });
      await prisma.taskHistory.create({
        data: {
          actionName: 'EXECUTOR_VIEWED',
          description: 'Mas\'ul ijrochi hujjatni ochib ko\'rdi va tanishdi 👁️',
          performedById: userId,
          documentId: document.id,
        },
      });

      // Tashabbuskorga / Boshliqqa bildirishnoma yuborish
      if (document.creatorId && document.creatorId !== userId) {
        await prisma.notification.create({
          data: {
            userId: document.creatorId,
            documentId: document.id,
            type: 'EXECUTOR_VIEWED',
            title: `👁️ Mas'ul ijrochi hujjatni ko'rdi`,
            message: `Mas'ul ijrochi "${document.title}" hujjatini ochib ko'rdi va tanishdi.`,
            link: `/dashboard/documents/${document.id}`,
          },
        });
      }

      (document as any).executorViewedAt = now;
    }

    sendSuccess(res, document, 'Hujjat tafsilotlari');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/documents
export const createDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      category,
      priority,
      docType = 'INTERNAL',
      docNumber: manualDocNumber, // Foydalanuvchi tomonidan kiritiladigan xat raqami
      senderOrg,
      senderDocNumber,
      senderDate,
      resolution,
      recipientOrg,
      deliveryMethod,
      parentDocId,
      overallDeadline,
      approvers, // JSON string: [{approverId, stepDeadline}, ...]
      executorId,
    } = req.body;

    if (!title || !description) {
      sendError(res, 'Sarlavha va tavsif talab etiladi', 400);
      return;
    }

    // Validatsiya: docType
    const validDocTypes = ['INCOMING', 'OUTGOING', 'INTERNAL'];
    const normalizedDocType = validDocTypes.includes(docType) ? docType : 'INTERNAL';

    let parsedApprovers: { approverId: number; stepDeadline?: string }[] = [];
    if (approvers) {
      try {
        const parsed = JSON.parse(approvers);
        if (Array.isArray(parsed)) {
          parsedApprovers = parsed.filter((a) => a && Number(a.approverId) > 0);
        }
      } catch {
        sendError(res, 'Tasdiqlovchilar formati noto\'g\'ri', 400);
        return;
      }
    }

    // Takroriy tasdiqlovchi tanlanishini taqiqlash (agar tasdiqlovchilar mavjud bo'lsa)
    if (parsedApprovers.length > 0) {
      const approverIds = parsedApprovers.map((a) => Number(a.approverId));
      const uniqueIds = new Set(approverIds);
      if (uniqueIds.size !== approverIds.length) {
        sendError(res, 'Tasdiqlash zanjirida bitta xodimni takroriy tanlash mumkin emas', 400);
        return;
      }
    }

    // Xat raqami: foydalanuvchi bersa - shu, bermasa - avtomatik generatsiya
    let docNumber: string;
    if (manualDocNumber && String(manualDocNumber).trim()) {
      docNumber = String(manualDocNumber).trim();
      // Takroriy raqamni tekshirish
      const existing = await prisma.document.findUnique({ where: { docNumber } });
      if (existing) {
        sendError(res, `"${docNumber}" raqami allaqachon mavjud. Boshqa raqam kiriting.`, 400);
        return;
      }
    } else {
      // Avtomatik generatsiya (KIR, CHIQ, ICH)
      const currentYear = new Date().getFullYear();
      let prefix = 'ICH';
      if (normalizedDocType === 'INCOMING') prefix = 'KIR';
      else if (normalizedDocType === 'OUTGOING') prefix = 'CHIQ';

      const count = await prisma.document.count({
        where: {
          docType: normalizedDocType,
          createdAt: {
            gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
            lte: new Date(`${currentYear}-12-31T23:59:59.999Z`),
          },
        },
      });
      
      let counter = count + 1;
      let generatedNumber = `${prefix}-${currentYear}-${String(counter).padStart(4, '0')}`;
      while (await prisma.document.findUnique({ where: { docNumber: generatedNumber } })) {
        counter++;
        generatedNumber = `${prefix}-${currentYear}-${String(counter).padStart(4, '0')}`;
      }
      docNumber = generatedNumber;
    }

    // Fayllarni ajratish (duplikat bo'lmasligi uchun ustuvorlik tekshiriladi)
    let uploadedFiles: Express.Multer.File[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        uploadedFiles = req.files;
      } else {
        const filesMap = req.files as Record<string, Express.Multer.File[]>;
        if (filesMap['files'] && filesMap['files'].length > 0) {
          uploadedFiles = filesMap['files'];
        } else if (filesMap['file'] && filesMap['file'].length > 0) {
          uploadedFiles = filesMap['file'];
        }
      }
    } else if (req.file) {
      uploadedFiles = [req.file];
    }

    // Dastlabki asosiy fayl (backward compatibility uchun)
    const primaryFile = uploadedFiles[0];
    const fileData = primaryFile
      ? {
          fileUrl: `/uploads/${primaryFile.filename}`,
          fileName: decodeFilename(primaryFile.originalname),
          fileSize: primaryFile.size,
        }
      : {};

    const document = await prisma.document.create({
      data: {
        docNumber,
        title,
        description,
        category: category || 'Umumiy',
        priority: priority || 'NORMAL',
        docType: normalizedDocType,
        senderOrg: senderOrg || null,
        senderDocNumber: senderDocNumber || null,
        senderDate: parseSafeDate(senderDate) || null,
        resolution: resolution || null,
        recipientOrg: recipientOrg || null,
        deliveryMethod: deliveryMethod || null,
        parentDocId: parentDocId && !isNaN(parseInt(parentDocId, 10)) ? parseInt(parentDocId, 10) : null,
        overallDeadline: parseSafeDate(overallDeadline),
        creatorId: req.user!.userId,
        executorId: executorId && !isNaN(parseInt(executorId, 10)) ? parseInt(executorId, 10) : null,
        ...fileData,
        // Bir nechta fayllarni DocumentAttachment jadvaliga saqlash
        attachments: uploadedFiles.length > 0 ? {
          create: uploadedFiles.map((f, idx) => ({
            fileUrl: `/uploads/${f.filename}`,
            fileName: decodeFilename(f.originalname),
            fileSize: f.size,
            fileType: idx === 0 ? 'MAIN' : 'ATTACHMENT',
            uploadedById: req.user!.userId,
          })),
        } : undefined,
        approvalSteps: {
          create: parsedApprovers.map((ap, index) => ({
            stepOrder: index + 1,
            approverId: ap.approverId,
            stepDeadline: parseSafeDate(ap.stepDeadline),
          })),
        },
        history: {
          create: {
            actionName: 'CREATED',
            description: `Hujjat yaratildi (${normalizedDocType === 'INCOMING' ? 'Kiruvchi' : normalizedDocType === 'OUTGOING' ? 'Chiquvchi' : 'Ichki'})`,
            performedById: req.user!.userId,
          },
        },
      },
      include: {
        creator: { select: { id: true, fullName: true, email: true, department: true } },
        executor: { select: { id: true, fullName: true, department: true } },
        parentDoc: { select: { id: true, docNumber: true, title: true, docType: true } },
        attachments: true,
        approvalSteps: {
          include: { approver: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    sendCreated(res, document, 'Hujjat muvaffaqiyatli yaratildi');
  } catch (err: any) {
    console.error('❌ Error creating document:', err);
    sendError(res, err?.message || 'Hujjat yaratishda xatolik yuz berdi', 500);
  }

};

// PATCH /api/documents/:id/submit
export const submitDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: { approvalSteps: { orderBy: { stepOrder: 'asc' } } },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (document.creatorId !== req.user!.userId) {
      sendError(res, 'Bu hujjatni yuborish uchun ruxsat yo\'q', 403);
      return;
    }

    if (document.status !== 'DRAFT') {
      sendError(res, 'Faqat qoralama hujjatni yuborish mumkin', 400);
      return;
    }

    const updatedDoc = await workflowService.submitDocument(docId, req.user!.userId);
    sendSuccess(res, updatedDoc, 'Hujjat tasdiqlashga yuborildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/documents/:id/execute — Ijroni yakunlash (Javob hujjati yuborish)
export const executeDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);
    const { executionNote } = req.body;

    if (!executionNote || executionNote.trim().length < 5) {
      sendError(res, 'Ijro izohi (kamida 5 ta belgi) talab etiladi', 400);
      return;
    }

    const document = await prisma.document.findUnique({ where: { id: docId } });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    // Faqat belgilangan ijrochi (yoki hujjat egasi) yoki Admin ijro qila oladi
    if (
      (document.executorId && document.executorId !== req.user!.userId && req.user!.role !== 'ADMIN') ||
      (!document.executorId && document.creatorId !== req.user!.userId && req.user!.role !== 'ADMIN')
    ) {
      sendError(res, 'Bu amalni bajarishga ruxsat yo\'q', 403);
      return;
    }

    if (document.status !== 'IN_EXECUTION') {
      sendError(res, 'Faqat ijroda bo\'lgan hujjatni yakunlash mumkin', 400);
      return;
    }

    // Fayl ma'lumotlari (ixtiyoriy)
    const file = req.file;
    const fileData = file
      ? {
          fileUrl: `/uploads/${file.filename}`,
          fileName: decodeFilename(file.originalname),
          fileSize: file.size,
        }
      : undefined;

    const updatedDoc = await workflowService.executeDocument(
      docId,
      req.user!.userId,
      executionNote.trim(),
      fileData
    );

    sendSuccess(res, updatedDoc, 'Ijro muvaffaqiyatli yakunlandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/documents/:id/file — Dastlabki faylni yuklash yoki yangilash
export const uploadDocumentFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({ where: { id: docId } });
    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (document.creatorId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      sendError(res, 'Faqat yaratuvchi yoki admin fayl yuklashi mumkin', 403);
      return;
    }

    const file = req.file;
    if (!file) {
      sendError(res, 'Fayl tanlanmadi', 400);
      return;
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        fileUrl: `/uploads/${file.filename}`,
        fileName: decodeFilename(file.originalname),
        fileSize: file.size,
        history: {
          create: {
            actionName: 'FILE_UPLOADED',
            description: `Dastlabki hujjat fayli biriktirildi: ${decodeFilename(file.originalname)}`,
            performedById: req.user!.userId,
          },
        },
      },
    });

    // Attachments jadvalida MAIN tipidagi faylni yangilash yoki yaratish (duplikat bo'lmasligi uchun)
    const existingMainAttachment = await prisma.documentAttachment.findFirst({
      where: { documentId: docId, fileType: 'MAIN' },
    });
    if (existingMainAttachment) {
      // Eski MAIN faylni diskdan o'chirish
      try {
        const oldFilePath = path.join(config.uploadDir, path.basename(existingMainAttachment.fileUrl));
        if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
      } catch (e) {
        console.warn('Eski dastlabki faylni o\'chirishda xatolik:', e);
      }
      // Yangi ma'lumotlar bilan yangilash
      await prisma.documentAttachment.update({
        where: { id: existingMainAttachment.id },
        data: {
          fileUrl: `/uploads/${file.filename}`,
          fileName: decodeFilename(file.originalname),
          fileSize: file.size,
          uploadedById: req.user!.userId,
        },
      });
    } else {
      await prisma.documentAttachment.create({
        data: {
          documentId: docId,
          fileUrl: `/uploads/${file.filename}`,
          fileName: decodeFilename(file.originalname),
          fileSize: file.size,
          fileType: 'MAIN',
          uploadedById: req.user!.userId,
        },
      });
    }

    sendSuccess(res, updated, 'Fayl muvaffaqiyatli biriktirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/documents/:id/close
export const closeDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({ where: { id: docId } });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (document.creatorId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      sendError(res, 'Bu amalni bajarishga ruxsat yo\'q', 403);
      return;
    }

    if (!['IN_EXECUTION', 'APPROVED'].includes(document.status)) {
      sendError(res, 'Faqat ijroda yoki tasdiqlangan hujjatni yopish mumkin', 400);
      return;
    }

    const updatedDoc = await prisma.document.update({
      where: { id: docId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        history: {
          create: {
            actionName: 'COMPLETED',
            description: 'Hujjat yakunlandi va yopildi',
            performedById: req.user!.userId,
          },
        },
      },
    });

    sendSuccess(res, updatedDoc, 'Hujjat muvaffaqiyatli yopildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/documents/:id — DRAFT hujjatni tahrirlash
export const updateDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);
    const {
      title,
      description,
      category,
      priority,
      docType,
      senderOrg,
      senderDocNumber,
      senderDate,
      resolution,
      recipientOrg,
      deliveryMethod,
      parentDocId,
      overallDeadline,
      approvers,
    } = req.body;

    const document = await prisma.document.findUnique({ where: { id: docId } });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (document.creatorId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      sendError(res, 'Bu hujjatni tahrirlash uchun ruxsat yo\'q', 403);
      return;
    }

    if (document.status !== 'DRAFT') {
      sendError(res, 'Faqat qoralama hujjatni tahrirlash mumkin', 400);
      return;
    }

    // Fayllarni ajratish (duplikat bo'lmasligi uchun ustuvorlik tekshiriladi)
    let uploadedFiles: Express.Multer.File[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        uploadedFiles = req.files;
      } else {
        const filesMap = req.files as Record<string, Express.Multer.File[]>;
        if (filesMap['files'] && filesMap['files'].length > 0) {
          uploadedFiles = filesMap['files'];
        } else if (filesMap['file'] && filesMap['file'].length > 0) {
          uploadedFiles = filesMap['file'];
        }
      }
    } else if (req.file) {
      uploadedFiles = [req.file];
    }

    const primaryFile = uploadedFiles[0];
    const fileData = primaryFile
      ? { fileUrl: `/uploads/${primaryFile.filename}`, fileName: decodeFilename(primaryFile.originalname), fileSize: primaryFile.size }
      : {};

    // Agar yangi approverlar bo'lsa eski bosqichlarni o'chirib qayta yaratamiz
    let approvalUpdate = {};
    if (approvers) {
      let parsedApprovers: { approverId: number; stepDeadline?: string }[];
      try { parsedApprovers = JSON.parse(approvers); } catch { parsedApprovers = []; }

      if (parsedApprovers.length > 0) {
        await prisma.approvalStep.deleteMany({ where: { documentId: docId } });
        approvalUpdate = {
          approvalSteps: {
            create: parsedApprovers.map((ap, index) => ({
              stepOrder: index + 1,
              approverId: ap.approverId,
              stepDeadline: ap.stepDeadline ? new Date(ap.stepDeadline) : undefined,
            })),
          },
        };
      }
    }

    const validDocTypes = ['INCOMING', 'OUTGOING', 'INTERNAL'];
    const normalizedDocType = docType && validDocTypes.includes(docType) ? docType : undefined;

    const updatedDoc = await prisma.document.update({
      where: { id: docId },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(category && { category }),
        ...(priority && { priority }),
        ...(normalizedDocType && { docType: normalizedDocType }),
        ...(senderOrg !== undefined && { senderOrg: senderOrg || null }),
        ...(senderDocNumber !== undefined && { senderDocNumber: senderDocNumber || null }),
        ...(senderDate !== undefined && { senderDate: senderDate ? new Date(senderDate) : null }),
        ...(resolution !== undefined && { resolution: resolution || null }),
        ...(recipientOrg !== undefined && { recipientOrg: recipientOrg || null }),
        ...(deliveryMethod !== undefined && { deliveryMethod: deliveryMethod || null }),
        ...(parentDocId !== undefined && { parentDocId: parentDocId ? parseInt(parentDocId) : null }),
        ...(overallDeadline !== undefined && { overallDeadline: overallDeadline ? new Date(overallDeadline) : null }),
        ...fileData,
        ...(uploadedFiles.length > 0 && {
          attachments: {
            create: uploadedFiles.map((f, idx) => ({
              fileUrl: `/uploads/${f.filename}`,
              fileName: decodeFilename(f.originalname),
              fileSize: f.size,
              fileType: idx === 0 ? 'MAIN' : 'ATTACHMENT',
              uploadedById: req.user!.userId,
            })),
          },
        }),
        ...approvalUpdate,
        history: {
          create: {
            actionName: 'UPDATED',
            description: 'Hujjat tahrirlandi',
            performedById: req.user!.userId,
          },
        },
      },
      include: {
        attachments: true,
        parentDoc: { select: { id: true, docNumber: true, title: true, docType: true } },
        approvalSteps: {
          include: { approver: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    sendSuccess(res, updatedDoc, 'Hujjat muvaffaqiyatli yangilandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Hujjat yangilashda xatolik', 500);
  }
};

// PATCH /api/documents/:id/resubmit — REJECTED hujjatni qayta yuborish
export const resubmitDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({
      where: { id: docId },
      include: { approvalSteps: true },
    });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (document.creatorId !== req.user!.userId) {
      sendError(res, 'Bu hujjatni qayta yuborish uchun ruxsat yo\'q', 403);
      return;
    }

    if (document.status !== 'REJECTED') {
      sendError(res, 'Faqat rad etilgan hujjatni qayta yuborish mumkin', 400);
      return;
    }

    const hasNoApprovers = !document.approvalSteps || document.approvalSteps.length === 0;
    const targetStatus = hasNoApprovers ? 'IN_EXECUTION' : 'IN_APPROVAL';

    // Barcha bosqichlarni PENDING ga qaytarish (agar bosqichlar bo'lsa)
    if (!hasNoApprovers) {
      await prisma.approvalStep.updateMany({
        where: { documentId: docId },
        data: { stepStatus: 'PENDING', comment: null, actionDate: null },
      });
    }

    const updatedDoc = await prisma.document.update({
      where: { id: docId },
      data: {
        status: targetStatus,
        submittedAt: new Date(),
        history: {
          create: {
            actionName: hasNoApprovers ? 'DIRECT_EXECUTION' : 'RESUBMITTED',
            description: hasNoApprovers
              ? 'Hujjat qayta topshirildi va to\'g\'ridan-to\'g\'ri ijroga yo\'naltirildi'
              : 'Hujjat rad etilgandan so\'ng qayta tasdiqlashga yuborildi',
            performedById: req.user!.userId,
          },
        },
      },
    });

    if (hasNoApprovers) {
      // Mas'ul ijrochiga bildirishnoma
      if (document.executorId && document.executorId !== req.user!.userId) {
        await prisma.notification.create({
          data: {
            userId: document.executorId,
            documentId: docId,
            type: 'APPROVAL_REQUEST',
            title: 'Yangi topshiriq ijroga kelib tushdi! 🚀',
            message: `"${document.title}" hujjati qayta topshirildi va to'g'ridan-to'g'ri ijro etishingiz uchun yo'naltirildi.`,
            link: `/dashboard/documents/${docId}`,
          },
        });
      }
    } else {
      // Birinchi tasdiqlovchiga bildirishnoma
      const firstStep = document.approvalSteps.find((s) => s.stepOrder === 1);
      if (firstStep) {
        await prisma.notification.create({
          data: {
            userId: firstStep.approverId,
            documentId: docId,
            type: 'APPROVAL_REQUEST',
            title: 'Qayta tasdiqlash so\'rovi',
            message: `"${document.title}" hujjati qayta tasdiqlashga yuborildi.`,
            link: `/dashboard/documents/${docId}`,
          },
        });
      }
    }

    sendSuccess(res, updatedDoc, hasNoApprovers ? 'Hujjat qayta topshirildi va ijroga yo\'naltirildi' : 'Hujjat qayta tasdiqlashga yuborildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// DELETE /api/documents/:id
export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({ where: { id: docId } });

    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    if (document.creatorId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      sendError(res, 'Bu hujjatni o\'chirish uchun ruxsat yo\'q', 403);
      return;
    }

    // Admin har qanday holatdagi hujjatni o'chira oladi.
    // Oddiy xodimlar esa faqat o'zlarining DRAFT yoki REJECTED hujjatlarini o'chira oladi.
    if (req.user!.role !== 'ADMIN' && !['DRAFT', 'REJECTED'].includes(document.status)) {
      sendError(res, 'Faqat qoralama yoki rad etilgan hujjatni o\'chirish mumkin', 400);
      return;
    }

    // Jismoniy fayllarni ham diskdan tozalash
    try {
      if (document.fileUrl) {
        const filePath = path.join(config.uploadDir, path.basename(document.fileUrl));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      if (document.executionFileUrl) {
        const execFilePath = path.join(config.uploadDir, path.basename(document.executionFileUrl));
        if (fs.existsSync(execFilePath)) fs.unlinkSync(execFilePath);
      }
    } catch (e) {
      console.warn('Fayllarni tozalashda xatolik:', e);
    }

    // Hujjatga tegishli barcha bildirishnomalarni tozalash
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { documentId: docId },
          { link: `/dashboard/documents/${docId}` },
          { link: `/documents/${docId}` },
        ],
      },
    });

    await prisma.document.delete({ where: { id: docId } });
    sendSuccess(res, null, 'Hujjat muvaffaqiyatli o\'chirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/documents/stats
export const getDocumentStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (req.user!.role !== 'ADMIN') {
      where.OR = [
        { creatorId: req.user!.userId },
        { executorId: req.user!.userId },
        { approvalSteps: { some: { approverId: req.user!.userId } } },
      ];
    }

    const [
      total,
      draft,
      inApproval,
      inExecution,
      approved,
      rejected,
      completed,
      expired,
      incoming,
      outgoing,
      internal,
      byCategoryRaw,
    ] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.count({ where: { ...where, status: 'DRAFT' } }),
      prisma.document.count({ where: { ...where, status: 'IN_APPROVAL' } }),
      prisma.document.count({ where: { ...where, status: 'IN_EXECUTION' } }),
      prisma.document.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.document.count({ where: { ...where, status: 'REJECTED' } }),
      prisma.document.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.document.count({ where: { ...where, status: 'EXPIRED' } }),
      prisma.document.count({ where: { ...where, docType: 'INCOMING' } }),
      prisma.document.count({ where: { ...where, docType: 'OUTGOING' } }),
      prisma.document.count({ where: { ...where, docType: 'INTERNAL' } }),
      prisma.document.groupBy({ by: ['category'], _count: { id: true }, where }),
    ]);

    const byCategory = byCategoryRaw.map(item => ({
      name: item.category,
      value: item._count.id,
    }));

    sendSuccess(
      res,
      {
        total,
        draft,
        inApproval,
        inExecution,
        approved,
        rejected,
        completed,
        expired,
        byDocType: {
          incoming,
          outgoing,
          internal,
        },
        byCategory,
      },
      'Statistika'
    );
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/documents/:id/attachments — Qo'shimcha fayl biriktirish
export const addDocumentAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const docId = parseInt(id);

    const document = await prisma.document.findUnique({ where: { id: docId } });
    if (!document) {
      sendError(res, 'Hujjat topilmadi', 404);
      return;
    }

    const file = req.file;
    if (!file) {
      sendError(res, 'Fayl tanlanmadi', 400);
      return;
    }

    const attachment = await prisma.documentAttachment.create({
      data: {
        documentId: docId,
        fileUrl: `/uploads/${file.filename}`,
        fileName: decodeFilename(file.originalname),
        fileSize: file.size,
        fileType: 'ATTACHMENT',
        uploadedById: req.user!.userId,
      },
    });

    await prisma.taskHistory.create({
      data: {
        documentId: docId,
        actionName: 'FILE_ATTACHED',
        description: `Yangi fayl biriktirildi: "${attachment.fileName}"`,
        performedById: req.user!.userId,
      },
    });

    sendCreated(res, attachment, 'Fayl muvaffaqiyatli biriktirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Fayl biriktirishda xatolik', 500);
  }
};

// DELETE /api/documents/:id/attachments/:attachmentId
export const deleteDocumentAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, attachmentId } = req.params;
    const docId = parseInt(id);
    const attachId = parseInt(attachmentId);

    const attachment = await prisma.documentAttachment.findUnique({
      where: { id: attachId },
      include: { document: true },
    });

    if (!attachment || attachment.documentId !== docId) {
      sendError(res, 'Fayl topilmadi', 404);
      return;
    }

    // Faqat yuklagan shaxs, hujjat yaratuvchisi yoki admin o'chira oladi
    if (
      attachment.uploadedById !== req.user!.userId &&
      attachment.document.creatorId !== req.user!.userId &&
      req.user!.role !== 'ADMIN'
    ) {
      sendError(res, 'Faylni o\'chirishga ruxsat yo\'q', 403);
      return;
    }

    // Diskdan o'chirish
    try {
      const filePath = path.join(config.uploadDir, path.basename(attachment.fileUrl));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('Faylni diskdan o\'chirishda xatolik:', e);
    }

    await prisma.documentAttachment.delete({ where: { id: attachId } });

    await prisma.taskHistory.create({
      data: {
        documentId: docId,
        actionName: 'FILE_DELETED',
        description: `Biriktirilgan fayl o'chirildi: "${attachment.fileName}"`,
        performedById: req.user!.userId,
      },
    });

    sendSuccess(res, null, 'Fayl muvaffaqiyatli o\'chirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Faylni o\'chirishda xatolik', 500);
  }
};

// POST /api/documents/:id/attachments/:attachmentId/view — Fayl ko'rildi (boshliqqa xabar)
export const viewDocumentAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, attachmentId } = req.params;
    const docId = parseInt(id);
    const attachId = parseInt(attachmentId);
    const viewerId = req.user!.userId;

    const attachment = await prisma.documentAttachment.findUnique({
      where: { id: attachId },
      include: {
        document: {
          include: {
            creator: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    if (!attachment || attachment.documentId !== docId) {
      sendError(res, 'Fayl topilmadi', 404);
      return;
    }

    const doc = attachment.document;

    // Agar faylni yaratuvchi o'zi ko'rsa — bildirishnoma yuborilmaydi
    if (viewerId === doc.creatorId) {
      sendSuccess(res, null, 'OK');
      return;
    }

    // Viewer ma'lumotlari
    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { fullName: true, department: true },
    });

    if (!viewer) {
      sendSuccess(res, null, 'OK');
      return;
    }

    // Audit log — fayl ko'rildi
    await prisma.taskHistory.create({
      data: {
        documentId: docId,
        actionName: 'FILE_VIEWED',
        description: `"${attachment.fileName}" fayli ko'rildi: ${viewer.fullName}${viewer.department ? ' (' + viewer.department + ')' : ''}`,
        performedById: viewerId,
      },
    });

    // Boshliqqa bildirishnoma yuborish
    const fileLabel = attachment.fileType === 'EXECUTION' ? 'ijro natijasi fayli' : 'biriktirilgan fayl';
    const notif = await prisma.notification.create({
      data: {
        userId: doc.creatorId,
        documentId: docId,
        type: 'FILE_VIEWED',
        title: `📂 Fayl ko'rildi`,
        message: `${viewer.fullName}${viewer.department ? ' (' + viewer.department + ')' : ''} "${doc.title}" hujjatidagi ${fileLabel}ni ko'rdi: "${attachment.fileName}"`,
        link: `/dashboard/documents/${docId}`,
      },
    });

    try {
      // Real-time socket bildirishnoma
      const { sendSocketNotification } = require('../server');
      sendSocketNotification(doc.creatorId, notif);
    } catch {
      // socket fallback
    }

    try {
      // Telegram orqali xabar yuborish
      const { telegramService } = require('../services/telegramService');

      // Yaratuvchiga xabar (agar u faylni o'zi ko'rmagan bo'lsa)
      if (viewerId !== doc.creatorId) {
        telegramService.sendFileViewed(doc.creatorId, {
          id: docId,
          title: doc.title,
          docNumber: doc.docNumber,
          viewerName: viewer.fullName,
          viewerDepartment: viewer.department,
          fileName: attachment.fileName,
        }).catch(() => {});
      }

      // ADMIN larга ham xabar yuborish (yaratuvchi admin bo'lmasa ham)
      const admins = await prisma.user.findMany({
        where: {
          role: 'ADMIN',
          isActive: true,
          telegramChatId: { not: null },
          id: { notIn: [viewerId, doc.creatorId] }, // viewer va yaratuvchi allaqachon oldi
        },
        select: { id: true },
      });
      for (const admin of admins) {
        telegramService.sendFileViewed(admin.id, {
          id: docId,
          title: doc.title,
          docNumber: doc.docNumber,
          viewerName: viewer.fullName,
          viewerDepartment: viewer.department,
          fileName: attachment.fileName,
        }).catch(() => {});
      }
    } catch {
      // telegram fallback
    }

    sendSuccess(res, null, 'Fayl ko\'rish qayd etildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

