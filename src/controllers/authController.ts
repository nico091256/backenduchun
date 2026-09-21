import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getTokenExpiry,
} from '../utils/jwt';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config';
import { parsePermissions } from '../utils/permissions';

// POST /api/auth/login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      sendError(res, 'Email va parol talab etiladi', 400);
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      sendError(res, 'Email yoki parol noto\'g\'ri', 401);
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      sendError(res, 'Email yoki parol noto\'g\'ri', 401);
      return;
    }

    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Refresh tokenni DB ga saqlash
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: getTokenExpiry(config.jwtRefreshExpiresIn),
      },
    });

    const { password: _, ...userWithoutPassword } = user;

    sendSuccess(res, {
      accessToken,
      refreshToken,
      user: {
        ...userWithoutPassword,
        permissions: parsePermissions(user.role, user.permissions),
      },
    }, 'Muvaffaqiyatli kirish');
  } catch (err) {
    console.error(err);
    sendError(res, 'Server xatosi', 500);
  }
};

// POST /api/auth/refresh
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      sendError(res, 'Refresh token talab etiladi', 400);
      return;
    }

    const payload = verifyRefreshToken(token);

    const storedToken = await prisma.refreshToken.findUnique({ where: { token } });
    if (!storedToken || storedToken.expiresAt < new Date()) {
      sendError(res, 'Yaroqsiz refresh token', 401);
      return;
    }

    // Eski tokenni o'chirish (rotation)
    await prisma.refreshToken.delete({ where: { token } });

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      sendError(res, 'Foydalanuvchi topilmadi', 401);
      return;
    }

    const newPayload = { userId: user.id, email: user.email, role: user.role };
    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: getTokenExpiry(config.jwtRefreshExpiresIn),
      },
    });

    sendSuccess(res, { accessToken: newAccessToken, refreshToken: newRefreshToken }, 'Token yangilandi');
  } catch {
    sendError(res, 'Yaroqsiz yoki muddati tugagan token', 401);
  }
};

// POST /api/auth/logout
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;

    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token } });
    }

    sendSuccess(res, null, 'Muvaffaqiyatli chiqish');
  } catch {
    sendError(res, 'Server xatosi', 500);
  }
};

// GET /api/auth/me
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        position: true,
        phone: true,
        avatar: true,
        isActive: true,
        permissions: true,
        createdAt: true,
        _count: {
          select: {
            createdDocuments: true,
            approvalSteps: true,
            notifications: { where: { isRead: false } },
          },
        },
      },
    });

    if (!user) {
      sendError(res, 'Foydalanuvchi topilmadi', 404);
      return;
    }

    sendSuccess(res, {
      ...user,
      permissions: parsePermissions(user.role, user.permissions),
    }, "Profil ma'lumotlari");
  } catch {
    sendError(res, 'Server xatosi', 500);
  }
};

// PATCH /api/auth/me — Profilni yangilash
export const updateMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fullName, department, position, phone, currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      sendError(res, 'Foydalanuvchi topilmadi', 404);
      return;
    }

    let hashedNewPassword: string | undefined;
    if (newPassword) {
      if (!currentPassword) {
        sendError(res, 'Joriy parolni kiriting', 400);
        return;
      }
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        sendError(res, "Joriy parol noto'g'ri", 400);
        return;
      }
      if (newPassword.length < 6) {
        sendError(res, "Yangi parol kamida 6 ta belgi bo'lishi kerak", 400);
        return;
      }
      hashedNewPassword = await bcrypt.hash(newPassword, 12);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        ...(fullName && { fullName }),
        ...(department !== undefined && { department }),
        ...(position !== undefined && { position }),
        ...(phone !== undefined && { phone }),
        ...(hashedNewPassword && { password: hashedNewPassword }),
      },
      select: {
        id: true, fullName: true, email: true, role: true,
        department: true, position: true, phone: true, isActive: true,
      },
    });

    sendSuccess(res, updatedUser, 'Profil yangilandi');
  } catch {
    sendError(res, 'Server xatosi', 500);
  }
};
