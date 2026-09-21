import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { parsePermissions } from '../utils/permissions';

// GET /api/users
export const getUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        position: true,
        phone: true,
        isActive: true,
        permissions: true,
        telegramChatId: true,
        createdAt: true,
        _count: {
          select: {
            createdDocuments: true,
            approvalSteps: true,
          },
        },
      },
    });

    const formattedUsers = users.map((u) => ({
      ...u,
      permissions: parsePermissions(u.role, u.permissions),
    }));

    sendSuccess(res, formattedUsers, 'Foydalanuvchilar ro\'yxati');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/users/:id
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        position: true,
        phone: true,
        isActive: true,
        permissions: true,
        telegramChatId: true,
        createdAt: true,
      },
    });

    if (!user) {
      sendError(res, 'Foydalanuvchi topilmadi', 404);
      return;
    }

    sendSuccess(res, {
      ...user,
      permissions: parsePermissions(user.role, user.permissions),
    }, 'Foydalanuvchi ma\'lumotlari');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/users
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, password, role, department, position, phone, permissions, telegramChatId } = req.body;

    if (!fullName || !email || !password || !role) {
      sendError(res, 'To\'liq ism, email, parol va rol talab etiladi', 400);
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      sendError(res, 'Bu email allaqachon ro\'yxatdan o\'tgan', 409);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const assignedPermissions = Array.isArray(permissions) && permissions.length > 0
      ? permissions
      : parsePermissions(role);

    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        role,
        department,
        position,
        phone,
        telegramChatId: telegramChatId ? String(telegramChatId).trim() : null,
        permissions: JSON.stringify(assignedPermissions),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        position: true,
        telegramChatId: true,
        isActive: true,
        permissions: true,
        createdAt: true,
      },
    });

    sendCreated(res, {
      ...user,
      permissions: assignedPermissions,
    }, 'Foydalanuvchi yaratildi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Foydalanuvchi yaratishda xatolik', 500);
  }
};

// PATCH /api/users/:id
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, department, position, phone, isActive, role, permissions, telegramChatId } = req.body;
    const userId = parseInt(req.params.id);

    // Agar email almashtirilayotgan bo'lsa, boshqa foydalanuvchida yo'qligini tekshirish
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id: userId },
        },
      });
      if (existingUser) {
        sendError(res, 'Ushbu email allaqachon boshqa foydalanuvchiga tegishli', 409);
        return;
      }
    }

    const dataToUpdate: Record<string, unknown> = {
      ...(fullName !== undefined && { fullName }),
      ...(email !== undefined && { email }),
      ...(department !== undefined && { department }),
      ...(position !== undefined && { position }),
      ...(phone !== undefined && { phone }),
      ...(telegramChatId !== undefined && { telegramChatId: telegramChatId ? String(telegramChatId).trim() : null }),
      ...(isActive !== undefined && { isActive }),
      ...(role !== undefined && { role }),
    };

    if (permissions !== undefined) {
      const permsArray = Array.isArray(permissions) ? permissions : [];
      dataToUpdate.permissions = JSON.stringify(permsArray);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        position: true,
        phone: true,
        telegramChatId: true,
        isActive: true,
        permissions: true,
      },
    });

    sendSuccess(res, {
      ...user,
      permissions: parsePermissions(user.role, user.permissions),
    }, 'Foydalanuvchi yangilandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Foydalanuvchi yangilashda xatolik', 500);
  }
};

// PATCH /api/users/:id/password
export const resetUserPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { newPassword } = req.body;
    const userId = parseInt(req.params.id);

    if (!newPassword || newPassword.length < 6) {
      sendError(res, 'Parol kamida 6 ta belgi bo\'lishi kerak', 400);
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    sendSuccess(res, null, 'Parol muvaffaqiyatli yangilandi');
  } catch (err) {
    console.error(err);
    sendError(res, 'Parolni yangilashda xatolik', 500);
  }
};

// DELETE /api/users/:id
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);

    if (userId === req.user!.userId) {
      sendError(res, 'O\'zingizni o\'chira olmaysiz', 400);
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    sendSuccess(res, null, 'Foydalanuvchi o\'chirildi (deaktivatsiya)');
  } catch (err) {
    console.error(err);
    sendError(res, 'Foydalanuvchi o\'chirishda xatolik', 500);
  }
};

// GET /api/users/approvers — faqat tasdiqlovchilar ro'yxati
export const getApprovers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const approvers = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, email: true, department: true, position: true },
      orderBy: { fullName: 'asc' },
    });

    sendSuccess(res, approvers, 'Tasdiqlovchilar ro\'yxati');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};
