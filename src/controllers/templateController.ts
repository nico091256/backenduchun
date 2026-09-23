import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';

// GET /api/templates — Barcha shablonlar ro'yxati
export const getAllTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category, docType, search } = req.query;

    const where: any = {};
    if (category) where.category = category as string;
    if (docType) where.docType = docType as string;
    if (search) {
      where.OR = [
        { title: { contains: search as string } },
        { content: { contains: search as string } },
        { description: { contains: search as string } },
      ];
    }

    const templates = await (prisma as any).documentTemplate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true, department: true } },
      },
    });

    sendSuccess(res, templates, 'Hujjat shablonlari');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/templates/:id — Bitta shablon ma'lumotlari
export const getTemplateById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const template = await (prisma as any).documentTemplate.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true, department: true } },
      },
    });

    if (!template) {
      sendError(res, 'Shablon topilmadi', 404);
      return;
    }

    sendSuccess(res, template, 'Shablon tafsilotlari');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/templates — Yangi shablon yaratish
export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, category, docType, content, defaultPriority, description } = req.body;

    if (!title || !category || !content) {
      sendError(res, 'Shablon nomi, kategoriya va mazmuni kiritilishi shart', 400);
      return;
    }

    const template = await (prisma as any).documentTemplate.create({
      data: {
        title: title.trim(),
        category: category.trim(),
        docType: docType || 'INTERNAL',
        content,
        defaultPriority: defaultPriority || 'NORMAL',
        description: description ? description.trim() : null,
        createdById: req.user!.userId,
      },
    });

    sendSuccess(res, template, 'Shablon muvaffaqiyatli yaratildi', 201);
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// PUT /api/templates/:id — Shablonni tahrirlash
export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { title, category, docType, content, defaultPriority, description } = req.body;

    const existing = await (prisma as any).documentTemplate.findUnique({ where: { id } });
    if (!existing) {
      sendError(res, 'Shablon topilmadi', 404);
      return;
    }

    const updated = await (prisma as any).documentTemplate.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(category && { category: category.trim() }),
        ...(docType && { docType }),
        ...(content && { content }),
        ...(defaultPriority && { defaultPriority }),
        ...(description !== undefined && { description: description ? description.trim() : null }),
      },
    });

    sendSuccess(res, updated, 'Shablon muvaffaqiyatli yangilandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// DELETE /api/templates/:id — Shablonni o'chirish
export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);

    const existing = await (prisma as any).documentTemplate.findUnique({ where: { id } });
    if (!existing) {
      sendError(res, 'Shablon topilmadi', 404);
      return;
    }

    await (prisma as any).documentTemplate.delete({ where: { id } });
    sendSuccess(res, null, 'Shablon o\'chirildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};
