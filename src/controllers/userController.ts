import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { parsePermissions, hasPermission } from '../utils/permissions';

// GET /api/users
export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requestingUser = req.user;
    let departmentFilter: string | undefined;

    // Agar ADMIN emas va USERS_MANAGE huquqi bo'lsa — faqat o'z bo'limi xodimlarini ko'rsin
    if (requestingUser && requestingUser.role !== 'ADMIN') {
      const dbUser = await prisma.user.findUnique({
        where: { id: requestingUser.userId },
        select: { role: true, permissions: true, department: true },
      });
      if (dbUser && hasPermission(dbUser, 'USERS_MANAGE')) {
        departmentFilter = dbUser.department || undefined;
      }
    }

    const whereClause = departmentFilter
      ? {
          OR: [
            { department: departmentFilter },
            { department: null },
            { department: '' },
          ],
        }
      : {};

    const users = await prisma.user.findMany({
      where: whereClause,
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
export const getUserById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
      sendError(res, 'Noto\'g\'ri foydalanuvchi IDsi', 400);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fullName, email, password, role, department, position, phone, permissions } = req.body;

    if (!fullName || !email || !password || !role) {
      sendError(res, 'To\'liq ism, email, parol va rol talab etiladi', 400);
      return;
    }

    // Bo'lim rahbari (USERS_MANAGE, not ADMIN) cheklovlari
    if (req.user && req.user.role !== 'ADMIN') {
      const requestingDbUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { role: true, permissions: true, department: true },
      });
      if (requestingDbUser && hasPermission(requestingDbUser, 'USERS_MANAGE')) {
        // ADMIN rolini bera olmaydi
        if (role === 'ADMIN') {
          sendError(res, 'Bo\'lim rahbari ADMIN roli bera olmaydi', 403);
          return;
        }
        // Faqat o'z bo'limiga qo'sha oladi
        const myDept = requestingDbUser.department || '';
        if (!myDept) {
          sendError(res, 'Sizning bo\'limingiz aniqlanmagan, administrator bilan bog\'laning', 403);
          return;
        }
        if (department && department !== myDept) {
          sendError(res, `Siz faqat "${myDept}" bo'limiga xodim qo'sha olasiz`, 403);
          return;
        }
        // Bo'lim avtomatik o'z bo'limiga o'rnatiladi
        req.body.department = myDept;
      }
    }

    const finalDepartment = req.body.department || department;

    // Bo'lim ID sini avtomatik aniqlash
    let deptIdToSet: number | null = null;
    if (finalDepartment) {
      const deptRecord = await prisma.department.findFirst({
        where: {
          OR: [
            { name: finalDepartment },
            { code: finalDepartment },
          ],
        },
      });
      if (deptRecord) {
        deptIdToSet = deptRecord.id;
      }
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
        department: finalDepartment,
        departmentId: deptIdToSet,
        position,
        phone,
        permissions: JSON.stringify(assignedPermissions),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        departmentId: true,
        position: true,
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
export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fullName, email, department, position, phone, isActive, role, permissions } = req.body;
    const userId = parseInt(req.params.id);

    // Bo'lim rahbari (USERS_MANAGE, not ADMIN) cheklovlari
    if (req.user && req.user.role !== 'ADMIN') {
      const requestingDbUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { role: true, permissions: true, department: true },
      });
      if (requestingDbUser && hasPermission(requestingDbUser, 'USERS_MANAGE')) {
        // ADMIN rolini bera olmaydi
        if (role === 'ADMIN') {
          sendError(res, 'Bo\'lim rahbari ADMIN roli bera olmaydi', 403);
          return;
        }
        // Faqat o'z bo'limidagi xodimni o'zgartira oladi
        const myDept = requestingDbUser.department || '';
        if (myDept) {
          const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { department: true, role: true },
          });
          if (!targetUser) {
            sendError(res, 'Foydalanuvchi topilmadi', 404);
            return;
          }
          if (targetUser.department !== myDept) {
            sendError(res, 'Siz faqat o\'z bo\'limingiz xodimini o\'zgartira olasiz', 403);
            return;
          }
          // Maqsadli foydalanuvchi ham ADMIN bo'lmasin
          if (targetUser.role === 'ADMIN') {
            sendError(res, 'Admin foydalanuvchini o\'zgartirish taqiqlangan', 403);
            return;
          }
        }
      }
    }

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
      ...(isActive !== undefined && { isActive }),
      ...(role !== undefined && { role }),
    };

    if (department !== undefined) {
      if (department) {
        const deptRecord = await prisma.department.findFirst({
          where: {
            OR: [
              { name: department },
              { code: department },
            ],
          },
        });
        dataToUpdate.departmentId = deptRecord ? deptRecord.id : null;
      } else {
        dataToUpdate.departmentId = null;
      }
    }

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

    // O'chiriladigan foydalanuvchini olish
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, department: true, fullName: true },
    });

    if (!targetUser) {
      sendError(res, 'Foydalanuvchi topilmadi', 404);
      return;
    }

    // ADMIN xodimni hech kim o'chira olmaydi (faqat super admin)
    if (targetUser.role === 'ADMIN' && req.user!.role !== 'ADMIN') {
      sendError(res, 'Admin foydalanuvchini o\'chirish taqiqlangan', 403);
      return;
    }

    // Bo'lim rahbari (USERS_MANAGE, not ADMIN) cheklovlari
    if (req.user!.role !== 'ADMIN') {
      const requestingDbUser = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { role: true, permissions: true, department: true },
      });
      if (requestingDbUser && hasPermission(requestingDbUser, 'USERS_MANAGE')) {
        const myDept = requestingDbUser.department || '';
        if (myDept && targetUser.department !== myDept) {
          sendError(res, 'Siz faqat o\'z bo\'limingiz xodimini o\'chira olasiz', 403);
          return;
        }
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    sendSuccess(res, null, `${targetUser.fullName} deaktivatsiya qilindi`);
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
