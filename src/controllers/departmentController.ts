import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { hasPermission } from '../utils/permissions';
import { OFFICIAL_DEPARTMENTS } from '../utils/departmentsData';

// GET /api/departments
export const getDepartments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let count = await prisma.department.count();
    if (count === 0) {
      for (const dept of OFFICIAL_DEPARTMENTS) {
        await prisma.department.create({
          data: {
            code: dept.code,
            name: dept.name,
            description: dept.description,
          },
        });
      }
    }

    // Bo'lim nomi bor, lekin departmentId biriktirilmagan foydalanuvchilarni avtomatik bog'lash
    const unlinkedUsers = await prisma.user.findMany({
      where: {
        departmentId: null,
        department: { not: null },
      },
      select: { id: true, department: true },
    });
    for (const u of unlinkedUsers) {
      if (u.department) {
        const d = await prisma.department.findFirst({
          where: {
            OR: [
              { name: u.department },
              { code: u.department },
            ],
          },
        });
        if (d) {
          await prisma.user.update({
            where: { id: u.id },
            data: { departmentId: d.id },
          });
        }
      }
    }

    const departments = await prisma.department.findMany({
      orderBy: { id: 'asc' },
      include: {
        parent: { select: { id: true, name: true, code: true } },
        children: { select: { id: true, name: true, code: true } },
        headUser: { select: { id: true, fullName: true, email: true, position: true, avatar: true, phone: true } },
        users: { select: { id: true, fullName: true, email: true, position: true, avatar: true, role: true } },
        _count: {
          select: { users: true, children: true },
        },
      },
    });

    sendSuccess(res, departments, 'Bo\'limlar ro\'yxati olindi');
  } catch (err) {
    console.error('getDepartments error:', err);
    sendError(res, 'Bo\'limlarni yuklashda xatolik', 500);
  }
};

// GET /api/departments/tree
export const getDepartmentTree = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let count = await prisma.department.count();
    if (count === 0) {
      for (const dept of OFFICIAL_DEPARTMENTS) {
        await prisma.department.create({
          data: {
            code: dept.code,
            name: dept.name,
            description: dept.description,
          },
        });
      }
    }

    // Top level departments (parentId === null)
    const rootDepartments = await prisma.department.findMany({
      where: { parentId: null },
      orderBy: { id: 'asc' },
      include: {
        headUser: { select: { id: true, fullName: true, email: true, position: true, avatar: true, phone: true } },
        users: { select: { id: true, fullName: true, email: true, position: true, avatar: true, role: true } },
        children: {
          include: {
            headUser: { select: { id: true, fullName: true, email: true, position: true, avatar: true, phone: true } },
            users: { select: { id: true, fullName: true, email: true, position: true, avatar: true, role: true } },
            children: {
              include: {
                headUser: { select: { id: true, fullName: true, email: true, position: true, avatar: true, phone: true } },
                users: { select: { id: true, fullName: true, email: true, position: true, avatar: true, role: true } },
              },
            },
            _count: { select: { users: true, children: true } },
          },
        },
        _count: { select: { users: true, children: true } },
      },
    });

    sendSuccess(res, rootDepartments, 'Tashkiliy iyerarxiya olindi');
  } catch (err) {
    console.error('getDepartmentTree error:', err);
    sendError(res, 'Tashkiliy iyerarxiyani yuklashda xatolik', 500);
  }
};

// POST /api/departments
export const createDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, description, parentId, headUserId } = req.body;

    if (!name || !name.trim()) {
      sendError(res, 'Bo\'lim nomi kiritilishi shart', 400);
      return;
    }

    const existing = await prisma.department.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      sendError(res, 'Bunday nomdagi bo\'lim allaqachon mavjud', 400);
      return;
    }

    const dept = await prisma.department.create({
      data: {
        name: name.trim(),
        code: code ? code.trim().toUpperCase() : null,
        description: description ? description.trim() : null,
        parentId: parentId ? Number(parentId) : null,
        headUserId: headUserId ? Number(headUserId) : null,
      },
      include: {
        headUser: { select: { id: true, fullName: true, email: true, position: true } },
        parent: { select: { id: true, name: true } },
      },
    });

    // Agar bo'lim boshlig'i belgilangan bo'lsa, ushbu foydalanuvchini ham bo'limga biriktiramiz
    if (headUserId) {
      await prisma.user.update({
        where: { id: Number(headUserId) },
        data: {
          departmentId: dept.id,
          department: dept.name,
        },
      });
    }

    sendCreated(res, dept, 'Bo\'lim muvaffaqiyatli yaratildi');
  } catch (err) {
    console.error('createDepartment error:', err);
    sendError(res, 'Bo\'lim yaratishda xatolik', 500);
  }
};

// PUT /api/departments/:id
export const updateDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, code, description, parentId, headUserId } = req.body;

    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) {
      sendError(res, 'Bo\'lim topilmadi', 404);
      return;
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        code: code !== undefined ? (code ? code.trim().toUpperCase() : null) : undefined,
        description: description !== undefined ? (description ? description.trim() : null) : undefined,
        parentId: parentId !== undefined ? (parentId ? Number(parentId) : null) : undefined,
        headUserId: headUserId !== undefined ? (headUserId ? Number(headUserId) : null) : undefined,
      },
      include: {
        headUser: { select: { id: true, fullName: true, email: true, position: true } },
        parent: { select: { id: true, name: true } },
      },
    });

    // Agar bo'lim boshlig'i belgilangan bo'lsa, foydalanuvchiga ham yangilaymiz
    if (headUserId) {
      await prisma.user.update({
        where: { id: Number(headUserId) },
        data: {
          departmentId: updated.id,
          department: updated.name,
        },
      });
    }

    sendSuccess(res, updated, 'Bo\'lim ma\'lumotlari yangilandi');
  } catch (err) {
    console.error('updateDepartment error:', err);
    sendError(res, 'Bo\'limni yangilashda xatolik', 500);
  }
};

// DELETE /api/departments/:id
export const deleteDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);

    const dept = await prisma.department.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, children: true } },
      },
    });

    if (!dept) {
      sendError(res, 'Bo\'lim topilmadi', 404);
      return;
    }

    if (dept._count.users > 0) {
      sendError(res, `Ushbu bo'limda ${dept._count.users} nafar xodim biriktirilgan. Avval xodimlarni boshqa bo'limga ko'chiring.`, 400);
      return;
    }

    if (dept._count.children > 0) {
      sendError(res, `Ushbu bo'limga bog'langan quyi bo'limlar mavjud. Avval ularni ko'chiring yoki o'chiring.`, 400);
      return;
    }

    await prisma.department.delete({ where: { id } });

    sendSuccess(res, null, 'Bo\'lim o\'chirildi');
  } catch (err) {
    console.error('deleteDepartment error:', err);
    sendError(res, 'Bo\'limni o\'chirishda xatolik', 500);
  }
};

// POST /api/departments/:id/assign-user
export const assignUserToDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = parseInt(req.params.id, 10);
    const { userId } = req.body;

    if (!userId) {
      sendError(res, 'Foydalanuvchi tanlanishi shart', 400);
      return;
    }

    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) {
      sendError(res, 'Bo\'lim topilmadi', 404);
      return;
    }

    // Bo'lim rahbari yoki Admin tekshiruvi
    if (req.user && req.user.role !== 'ADMIN') {
      const requestingDbUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, role: true, permissions: true, department: true },
      });

      const isHead = dept.headUserId === req.user.userId;
      const isDeptLeader = requestingDbUser && hasPermission(requestingDbUser, 'USERS_MANAGE') && requestingDbUser.department === dept.name;

      if (!isHead && !isDeptLeader) {
        sendError(res, 'Siz faqat o\'z bo\'limingizga xodim biriktira olasiz', 403);
        return;
      }
    }

    const user = await prisma.user.update({
      where: { id: Number(userId) },
      data: {
        departmentId: dept.id,
        department: dept.name,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        department: true,
        departmentId: true,
        position: true,
      },
    });

    sendSuccess(res, user, `${user.fullName} muvaffaqiyatli ${dept.name} bo'limiga biriktirildi`);
  } catch (err) {
    console.error('assignUserToDepartment error:', err);
    sendError(res, 'Xodimni bo\'limga biriktirishda xatolik', 500);
  }
};

// POST /api/departments/:id/unassign-user
export const unassignUserFromDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = parseInt(req.params.id, 10);
    const { userId } = req.body;

    if (!userId) {
      sendError(res, 'Foydalanuvchi tanlanishi shart', 400);
      return;
    }

    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) {
      sendError(res, 'Bo\'lim topilmadi', 404);
      return;
    }

    // Bo'lim rahbari yoki Admin tekshiruvi
    if (req.user && req.user.role !== 'ADMIN') {
      const requestingDbUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, role: true, permissions: true, department: true },
      });

      const isHead = dept.headUserId === req.user.userId;
      const isDeptLeader = requestingDbUser && hasPermission(requestingDbUser, 'USERS_MANAGE') && requestingDbUser.department === dept.name;

      if (!isHead && !isDeptLeader) {
        sendError(res, 'Siz faqat o\'z bo\'limingizdan xodimni chiqara olasiz', 403);
        return;
      }
    }

    // Agar ushbu xodim bo'lim boshlig'i (headUserId) bo'lsa, headUserId ni ham bo'shatamiz
    if (dept.headUserId === Number(userId)) {
      await prisma.department.update({
        where: { id: departmentId },
        data: { headUserId: null },
      });
    }

    const user = await prisma.user.update({
      where: { id: Number(userId) },
      data: {
        departmentId: null,
        department: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        department: true,
        departmentId: true,
        position: true,
      },
    });

    sendSuccess(res, user, `${user.fullName} «${dept.name}» bo'limidan chiqarildi`);
  } catch (err) {
    console.error('unassignUserFromDepartment error:', err);
    sendError(res, 'Xodimni bo\'limdan chiqarishda xatolik', 500);
  }
};
