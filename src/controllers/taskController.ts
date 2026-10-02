import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { sendSuccess, sendError, sendCreated } from '../utils/apiResponse';
import { AuthRequest } from '../middleware/auth';
import { emailService } from '../services/emailService';

// UTF-8 file name encoding fixer for Multer
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

// Helper: Foydalanuvchi va uning bo'limi a'zolari ID larini olish
const getDeptMemberIds = async (userId: number, isAdmin: boolean) => {
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      headedDepts: true,
      dept: true,
    },
  });

  let userPermissions: string[] = [];
  try {
    userPermissions = JSON.parse(currentUser?.permissions || '[]');
  } catch {}

  const isDeptHead = (currentUser?.headedDepts && currentUser.headedDepts.length > 0) || false;
  const canManageTasks = isAdmin || isDeptHead || userPermissions.includes('USERS_MANAGE') || userPermissions.includes('ASSIGN_TASK');

  let deptUserIds: number[] = [];
  const deptNames = [
    ...(currentUser?.headedDepts.map((d) => d.name) || []),
    currentUser?.department,
  ].filter(Boolean) as string[];

  const deptIds = currentUser?.headedDepts.map((d) => d.id) || [];

  if (deptNames.length > 0 || deptIds.length > 0) {
    const deptMembers = await prisma.user.findMany({
      where: {
        OR: [
          { department: { in: deptNames } },
          { departmentId: { in: deptIds } },
        ],
      },
      select: { id: true },
    });
    deptUserIds = deptMembers.map((m) => m.id);
  }

  // O'z ID sini ham qo'shib qo'yish
  if (!deptUserIds.includes(userId)) {
    deptUserIds.push(userId);
  }

  return {
    currentUser,
    isDeptHead,
    canManageTasks,
    deptUserIds,
    departmentName: currentUser?.department || currentUser?.headedDepts[0]?.name || 'Bo\'lim',
  };
};

// GET /api/tasks — Barcha topshiriqlar ro'yxati (Filtrlar bilan)
export const getTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';
    const {
      scope = 'all',
      status,
      priority,
      search,
      documentId,
      employeeId,
      page = '1',
      limit = '15',
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 15;
    const skip = (pageNum - 1) * limitNum;

    const { isDeptHead, canManageTasks, deptUserIds } = await getDeptMemberIds(userId, isAdmin);

    const where: Record<string, unknown> = {};
    const andConditions: any[] = [];

    const now = new Date();
    const in3Days = new Date();
    in3Days.setDate(in3Days.getDate() + 3);
    in3Days.setHours(23, 59, 59, 999);

    // Topshiriqlar ko'lami (Scope)
    if (scope === 'department') {
      // Rahbar o'z bo'limidagi barcha xodimlarning topshiriqlarini ko'radi
      andConditions.push({
        OR: [
          { assigneeId: { in: deptUserIds } },
          { coAssignees: { some: { userId: { in: deptUserIds } } } },
          { creatorId: { in: deptUserIds } },
        ],
      });
    } else if (scope === 'assigned_to_me') {
      andConditions.push({
        OR: [
          { assigneeId: userId },
          { coAssignees: { some: { userId } } },
        ],
      });
    } else if (scope === 'assigned_by_me') {
      andConditions.push({ creatorId: userId });
    } else if (scope === 'due_soon') {
      // 3 kun ichida muddati tugaydigan faol topshiriqlar
      andConditions.push({
        status: { in: ['NEW', 'IN_PROGRESS'] },
        deadline: {
          gte: now,
          lte: in3Days,
        },
      });
      if (!isAdmin) {
        andConditions.push({
          OR: [
            { assigneeId: userId },
            { creatorId: userId },
            { coAssignees: { some: { userId } } },
            ...(canManageTasks ? [{ assigneeId: { in: deptUserIds } }] : []),
          ],
        });
      }
    } else if (scope === 'overdue') {
      andConditions.push({
        deadline: { lt: now },
        status: { in: ['NEW', 'IN_PROGRESS', 'OVERDUE'] },
      });
      if (!isAdmin) {
        andConditions.push({
          OR: [
            { assigneeId: userId },
            { creatorId: userId },
            { coAssignees: { some: { userId } } },
            ...(canManageTasks ? [{ assigneeId: { in: deptUserIds } }] : []),
          ],
        });
      }
    } else if (scope === 'completed') {
      andConditions.push({ status: 'COMPLETED' });
      if (!isAdmin) {
        andConditions.push({
          OR: [
            { assigneeId: userId },
            { creatorId: userId },
            { coAssignees: { some: { userId } } },
            ...(canManageTasks ? [{ assigneeId: { in: deptUserIds } }] : []),
          ],
        });
      }
    } else {
      // scope === 'all'
      if (!isAdmin) {
        andConditions.push({
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
            { coAssignees: { some: { userId } } },
            ...(canManageTasks ? [{ assigneeId: { in: deptUserIds } }] : []),
          ],
        });
      }
    }

    // Aniq bir xodim bo'yicha filter (Bo'lim monitoring doskasi uchun)
    if (employeeId && !isNaN(Number(employeeId))) {
      const empId = Number(employeeId);
      andConditions.push({
        OR: [
          { assigneeId: empId },
          { coAssignees: { some: { userId: empId } } },
        ],
      });
    }

    // Holat filtri
    if (status) {
      where.status = status;
    }

    // Ustuvorlik filtri
    if (priority) {
      where.priority = priority;
    }

    // Bog'langan hujjat bo'yicha filter
    if (documentId) {
      where.documentId = parseInt(documentId as string, 10);
    }

    // Qidiruv (Mavzu, topshiriq raqami, ko'rsatma matni)
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      andConditions.push({
        OR: [
          { title: { contains: q } },
          { taskNumber: { contains: q } },
          { description: { contains: q } },
          { assignee: { fullName: { contains: q } } },
          { creator: { fullName: { contains: q } } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            select: { id: true, fullName: true, email: true, department: true, position: true },
          },
          assignee: {
            select: { id: true, fullName: true, email: true, department: true, position: true },
          },
          coAssignees: {
            include: {
              user: {
                select: { id: true, fullName: true, department: true, position: true },
              },
            },
          },
          document: {
            select: { id: true, docNumber: true, title: true, docType: true },
          },
          attachments: true,
          _count: {
            select: { comments: true, activities: true, attachments: true },
          },
        },
      }),
      prisma.task.count({ where }),
    ]);

    sendSuccess(res, tasks, 'Topshiriqlar ro\'yxati', 200, {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) {
    console.error('getTasks error:', err);
    sendError(res, 'Topshiriqlarni olishda xatolik yuz berdi', 500);
  }
};

// GET /api/tasks/stats — Topshiriqlar statistikasi (KPI ko'rsatkichlari)
export const getTaskStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';
    const now = new Date();
    const in3Days = new Date();
    in3Days.setDate(in3Days.getDate() + 3);
    in3Days.setHours(23, 59, 59, 999);

    const { isDeptHead, canManageTasks, deptUserIds, departmentName } = await getDeptMemberIds(userId, isAdmin);

    const assignedToMeBase = {
      OR: [
        { assigneeId: userId },
        { coAssignees: { some: { userId } } },
      ],
    };

    const assignedByMeBase = {
      creatorId: userId,
    };

    // Bo'lim a'zolariga berilgan topshiriqlar bazasi
    const deptAssigneeWhere = {
      OR: [
        { assigneeId: { in: deptUserIds } },
        { coAssignees: { some: { userId: { in: deptUserIds } } } },
      ],
    };

    const [
      assignedToMeTotal,
      assignedToMePending,
      assignedToMeCompleted,
      assignedToMeOverdue,
      assignedByMeTotal,
      assignedByMePending,
      assignedByMeCompleted,
      allTotal,
      // Bo'lim monitoring ko'rsatkichlari
      departmentTotal,
      departmentPending,
      departmentDueSoon,
      departmentOverdue,
      departmentCompleted,
    ] = await Promise.all([
      prisma.task.count({ where: assignedToMeBase }),
      prisma.task.count({
        where: {
          ...assignedToMeBase,
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
      }),
      prisma.task.count({
        where: {
          ...assignedToMeBase,
          status: 'COMPLETED',
        },
      }),
      prisma.task.count({
        where: {
          ...assignedToMeBase,
          status: { in: ['NEW', 'IN_PROGRESS', 'OVERDUE'] },
          deadline: { lt: now },
        },
      }),
      prisma.task.count({ where: assignedByMeBase }),
      prisma.task.count({
        where: {
          ...assignedByMeBase,
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
      }),
      prisma.task.count({
        where: {
          ...assignedByMeBase,
          status: 'COMPLETED',
        },
      }),
      prisma.task.count(),
      // Bo'lim totals
      prisma.task.count({ where: deptAssigneeWhere }),
      prisma.task.count({
        where: {
          ...deptAssigneeWhere,
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
      }),
      prisma.task.count({
        where: {
          ...deptAssigneeWhere,
          status: { in: ['NEW', 'IN_PROGRESS'] },
          deadline: { gte: now, lte: in3Days },
        },
      }),
      prisma.task.count({
        where: {
          ...deptAssigneeWhere,
          status: { in: ['NEW', 'IN_PROGRESS', 'OVERDUE'] },
          deadline: { lt: now },
        },
      }),
      prisma.task.count({
        where: {
          ...deptAssigneeWhere,
          status: 'COMPLETED',
        },
      }),
    ]);

    const departmentKpiScore =
      departmentTotal > 0
        ? Math.round((departmentCompleted / departmentTotal) * 100)
        : 100;

    sendSuccess(
      res,
      {
        assignedToMeTotal,
        assignedToMePending,
        assignedToMeCompleted,
        assignedToMeOverdue,
        assignedByMeTotal,
        assignedByMePending,
        assignedByMeCompleted,
        allTotal,
        // Bo'lim doskasi uchun
        isDeptHead: isDeptHead || isAdmin || canManageTasks,
        departmentName,
        departmentEmployeesCount: deptUserIds.length,
        departmentTotal,
        departmentPending,
        departmentDueSoon,
        departmentOverdue,
        departmentCompleted,
        departmentKpiScore,
      },
      'Topshiriqlar statistikasi'
    );
  } catch (err) {
    console.error('getTaskStats error:', err);
    sendError(res, 'Statistikani olishda xatolik', 500);
  }
};

// GET /api/tasks/:id — Topshiriq tafsilotlari
export const getTaskById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: {
          select: { id: true, fullName: true, email: true, department: true, position: true },
        },
        assignee: {
          select: { id: true, fullName: true, email: true, department: true, position: true },
        },
        coAssignees: {
          include: {
            user: {
              select: { id: true, fullName: true, email: true, department: true, position: true },
            },
          },
        },
        document: {
          select: { id: true, docNumber: true, title: true, docType: true, status: true, priority: true },
        },
        attachments: true,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, fullName: true, department: true, position: true } },
          },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedBy: { select: { id: true, fullName: true, department: true } },
          },
        },
      },
    });

    if (!task) {
      sendError(res, 'Topshiriq topilmadi', 404);
      return;
    }

    const { canManageTasks, deptUserIds } = await getDeptMemberIds(userId, isAdmin);

    // Ruxsat tekshiruvi: Shaxsiy daxldorlik yoki bo'lim boshlig'i/rahbarlik
    const isMember =
      task.creatorId === userId ||
      task.assigneeId === userId ||
      task.coAssignees.some((ca) => ca.userId === userId) ||
      (canManageTasks && deptUserIds.includes(task.assigneeId || 0));

    if (!isMember && !isAdmin) {
      sendError(res, 'Ushbu topshiriqni ko\'rish huquqiga ega emassiz', 403);
      return;
    }

    // Mas'ul ijrochi birinchi marta ochib ko'rganida viewedAt ni belgilash
    if (task.assigneeId === userId && !task.viewedAt) {
      const now = new Date();
      await prisma.task.update({
        where: { id: taskId },
        data: {
          viewedAt: now,
          status: task.status === 'NEW' ? 'IN_PROGRESS' : undefined,
        },
      });

      await prisma.taskActivity.create({
        data: {
          taskId,
          action: 'VIEWED',
          description: 'Mas\'ul ijrochi topshiriqni ochib ko\'rdi va tanishdi 👁️',
          performedById: userId,
        },
      });

      // Topshiruvchiga xabar yuborish
      if (task.creatorId !== userId) {
        await prisma.notification.create({
          data: {
            userId: task.creatorId,
            type: 'TASK_VIEWED',
            title: '👁️ Topshiriq ko\'rildi',
            message: `Mas'ul ijrochi "${task.title}" topshirig'ini ochib ko'rdi.`,
            link: `/dashboard/tasks/${taskId}`,
          },
        });
      }

      task.viewedAt = now;
      if (task.status === 'NEW') task.status = 'IN_PROGRESS';
    }

    sendSuccess(res, task, 'Topshiriq tafsilotlari');
  } catch (err) {
    console.error('getTaskById error:', err);
    sendError(res, 'Topshiriqni yuklashda xatolik', 500);
  }
};

// POST /api/tasks — Yangi topshiriq yaratish
export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const {
      title,
      description,
      priority = 'NORMAL',
      deadline,
      assigneeId,
      coAssigneeIds,
      documentId,
    } = req.body;

    if (!title || !description) {
      sendError(res, 'Topshiriq mavzusi va mazmuni talab etiladi', 400);
      return;
    }

    if (!assigneeId) {
      sendError(res, 'Asosiy mas\'ul ijrochi xodim tanlanishi lozim', 400);
      return;
    }

    const assignedUser = await prisma.user.findUnique({
      where: { id: Number(assigneeId) },
      select: { id: true, fullName: true, email: true, department: true },
    });

    if (!assignedUser) {
      sendError(res, 'Belgilangan ijrochi xodim topilmadi', 404);
      return;
    }

    // Ham-ijrochilarni parse qilish
    let parsedCoAssignees: number[] = [];
    if (coAssigneeIds) {
      if (Array.isArray(coAssigneeIds)) {
        parsedCoAssignees = coAssigneeIds.map(Number).filter((n) => !isNaN(n) && n > 0 && n !== Number(assigneeId));
      } else if (typeof coAssigneeIds === 'string') {
        try {
          const parsed = JSON.parse(coAssigneeIds);
          if (Array.isArray(parsed)) {
            parsedCoAssignees = parsed.map(Number).filter((n) => !isNaN(n) && n > 0 && n !== Number(assigneeId));
          }
        } catch {
          parsedCoAssignees = coAssigneeIds
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n) && n > 0 && n !== Number(assigneeId));
        }
      }
      parsedCoAssignees = Array.from(new Set(parsedCoAssignees));
    }

    // Topshiriq raqamini generatsiya qilish (TOP-YYYY-NNNN)
    const currentYear = new Date().getFullYear();
    const count = await prisma.task.count({
      where: {
        createdAt: {
          gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
          lte: new Date(`${currentYear}-12-31T23:59:59.999Z`),
        },
      },
    });

    let counter = count + 1;
    let generatedTaskNumber = `TOP-${currentYear}-${String(counter).padStart(4, '0')}`;
    while (await prisma.task.findUnique({ where: { taskNumber: generatedTaskNumber } })) {
      counter++;
      generatedTaskNumber = `TOP-${currentYear}-${String(counter).padStart(4, '0')}`;
    }

    // Fayllarni olish
    let uploadedFiles: Express.Multer.File[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        uploadedFiles = req.files;
      } else {
        const filesMap = req.files as Record<string, Express.Multer.File[]>;
        if (filesMap['files']) uploadedFiles = filesMap['files'];
        else if (filesMap['file']) uploadedFiles = filesMap['file'];
      }
    } else if (req.file) {
      uploadedFiles = [req.file];
    }

    const task = await prisma.task.create({
      data: {
        taskNumber: generatedTaskNumber,
        title: title.trim(),
        description: description.trim(),
        priority: priority || 'NORMAL',
        status: 'NEW',
        deadline: parseSafeDate(deadline),
        creatorId: userId,
        assigneeId: Number(assigneeId),
        documentId: documentId && !isNaN(Number(documentId)) ? Number(documentId) : null,
        coAssignees: parsedCoAssignees.length > 0 ? {
          create: parsedCoAssignees.map((uId) => ({ userId: uId })),
        } : undefined,
        attachments: uploadedFiles.length > 0 ? {
          create: uploadedFiles.map((f) => ({
            fileUrl: `/uploads/${f.filename}`,
            fileName: decodeFilename(f.originalname),
            fileSize: f.size,
            uploadedById: userId,
          })),
        } : undefined,
        activities: {
          create: {
            action: 'CREATED',
            description: `Topshiriq yaratildi va ${assignedUser.fullName}ga biriktirildi`,
            performedById: userId,
          },
        },
      },
      include: {
        creator: { select: { id: true, fullName: true, department: true } },
        assignee: { select: { id: true, fullName: true, department: true, email: true } },
        coAssignees: { include: { user: { select: { id: true, fullName: true, department: true } } } },
        document: { select: { id: true, docNumber: true, title: true } },
        attachments: true,
      },
    });

    // Ijrochiga bildirishnoma yaratish
    const notif = await prisma.notification.create({
      data: {
        userId: Number(assigneeId),
        type: 'APPROVAL_REQUEST',
        title: 'Sizga yangi topshiriq berildi! 📋',
        message: `"${task.title}" (${task.taskNumber}) topshirig'i ijro etishingiz uchun yuklatildi. Topshiruvchi: ${task.creator.fullName}`,
        link: `/dashboard/tasks`,
      },
    });

    try {
      const { sendSocketNotification } = require('../server');
      sendSocketNotification(Number(assigneeId), notif);
    } catch {}

    // Ijrochiga Email xabarnoma
    if (assignedUser.email) {
      emailService.sendTaskAssignedEmail({
        toEmail: assignedUser.email,
        executorName: assignedUser.fullName,
        docNumber: task.taskNumber,
        docTitle: task.title,
        deadline: deadline ? new Date(deadline).toLocaleDateString('uz-UZ') : undefined,
        resolution: task.description,
        docId: task.id,
      }).catch((err) => console.error('Task email error:', err));
    }

    sendCreated(res, task, 'Topshiriq muvaffaqiyatli yaratildi');
  } catch (err) {
    console.error('createTask error:', err);
    sendError(res, 'Topshiriq yaratishda xatolik', 500);
  }
};

// PATCH /api/tasks/:id/execute — Topshiriq ijrosini yakunlash (Hisobot topshirish)
export const completeTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';
    const { resultNote } = req.body;

    if (!resultNote || resultNote.trim().length < 5) {
      sendError(res, 'Bajarilgan ishlar hisoboti (kamida 5 ta belgi) talab etiladi', 400);
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        coAssignees: true,
        creator: { select: { id: true, fullName: true } },
      },
    });

    if (!task) {
      sendError(res, 'Topshiriq topilmadi', 404);
      return;
    }

    const isAssignee = task.assigneeId === userId;
    const isCoAssignee = task.coAssignees.some((ca) => ca.userId === userId);
    const isCreator = task.creatorId === userId;

    if (!isAssignee && !isCoAssignee && !isCreator && !isAdmin) {
      sendError(res, 'Ushbu topshiriq bo\'yicha hisobot topshirish huquqiga ega emassiz', 403);
      return;
    }

    const file = req.file;
    const now = new Date();

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        resultNote: resultNote.trim(),
        ...(file && {
          resultFileUrl: `/uploads/${file.filename}`,
          resultFileName: decodeFilename(file.originalname),
          resultFileSize: file.size,
        }),
      },
      include: {
        creator: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
      },
    });

    // Faoliyat logi
    await prisma.taskActivity.create({
      data: {
        taskId,
        action: 'COMPLETED',
        description: `Topshiriq ijrosi yakunlandi va hisobot topshirildi: ${resultNote.trim().slice(0, 100)}...`,
        performedById: userId,
      },
    });

      // Topshiriq beruvchiga bildirishnoma
      if (task.creatorId !== userId) {
        const notif = await prisma.notification.create({
          data: {
            userId: task.creatorId,
            type: 'DOCUMENT_APPROVED',
            title: 'Topshiriq bajarildi! 🎉',
            message: `"${task.title}" (${task.taskNumber}) topshirig'i bo'yicha ijro hisoboti topshirildi.`,
            link: `/dashboard/tasks`,
          },
        });

        try {
          const { sendSocketNotification } = require('../server');
          sendSocketNotification(task.creatorId, notif);
        } catch {}
      }

      // Bog'langan rasmiy hujjat bo'lsa, uni ham avtomatik COMPLETED holatiga o'tkazish
      if (task.documentId) {
        try {
          const doc = await prisma.document.findUnique({
            where: { id: task.documentId },
          });

          if (doc && (doc.status === 'IN_EXECUTION' || doc.status === 'EXPIRED')) {
            await prisma.document.update({
              where: { id: doc.id },
              data: {
                status: 'COMPLETED',
                completedAt: now,
                executionNote: resultNote.trim(),
                ...(file && {
                  executionFileUrl: `/uploads/${file.filename}`,
                  executionFileName: decodeFilename(file.originalname),
                }),
              },
            });

            if (file) {
              await prisma.documentAttachment.create({
                data: {
                  documentId: doc.id,
                  fileUrl: `/uploads/${file.filename}`,
                  fileName: decodeFilename(file.originalname),
                  fileSize: file.size,
                  fileType: 'EXECUTION',
                  uploadedById: userId,
                },
              });
            }

            await prisma.taskHistory.create({
              data: {
                documentId: doc.id,
                actionName: 'EXECUTED_VIA_TASK',
                description: `Topshiriq (${task.taskNumber}) orqali ijro yakunlandi va hisobot biriktirildi: ${resultNote.trim()}`,
                performedById: userId,
              },
            });
          }
        } catch (docSyncErr) {
          console.error('Error synchronizing document from completed task:', docSyncErr);
        }
      }

      sendSuccess(res, updatedTask, 'Topshiriq ijrosi muvaffaqiyatli yakunlandi');
  } catch (err) {
    console.error('completeTask error:', err);
    sendError(res, 'Ijroni yakunlashda xatolik yuz berdi', 500);
  }
};

// POST /api/tasks/:id/comments — Topshiriq bo'yicha muhokama izohi yozish
export const addTaskComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const userId = req.user!.userId;
    const { comment } = req.body;

    if (!comment || !comment.trim()) {
      sendError(res, 'Izoh matni talab etiladi', 400);
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { coAssignees: true },
    });

    if (!task) {
      sendError(res, 'Topshiriq topilmadi', 404);
      return;
    }

    const isMember =
      task.creatorId === userId ||
      task.assigneeId === userId ||
      task.coAssignees.some((ca) => ca.userId === userId) ||
      req.user!.role === 'ADMIN';

    if (!isMember) {
      sendError(res, 'Ushbu topshiriqda izoh qoldirish huquqi yo\'q', 403);
      return;
    }

    const file = req.file;

    const newComment = await prisma.taskComment.create({
      data: {
        taskId,
        userId,
        comment: comment.trim(),
        ...(file && {
          fileUrl: `/uploads/${file.filename}`,
          fileName: decodeFilename(file.originalname),
        }),
      },
      include: {
        user: { select: { id: true, fullName: true, department: true, position: true } },
      },
    });

    // Boshqa tomonga xabarnoma yuborish
    const targetUserId = task.creatorId === userId ? task.assigneeId : task.creatorId;
    if (targetUserId && targetUserId !== userId) {
      await prisma.notification.create({
        data: {
          userId: targetUserId,
          type: 'COMMENT_ADDED',
          title: 'Topshiriq bo\'yicha yangi izoh 💬',
          message: `${newComment.user.fullName}: "${comment.trim().slice(0, 80)}"`,
          link: `/dashboard/tasks`,
        },
      });
    }

    sendCreated(res, newComment, 'Izoh qo\'shildi');
  } catch (err) {
    console.error('addTaskComment error:', err);
    sendError(res, 'Izoh qoldirishda xatolik', 500);
  }
};

// DELETE /api/tasks/:id — Topshiriqni o'chirish
export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      sendError(res, 'Topshiriq topilmadi', 404);
      return;
    }

    if (task.creatorId !== userId && !isAdmin) {
      sendError(res, 'Faqat topshiriq muallifi yoki administrator o\'chira oladi', 403);
      return;
    }

    await prisma.task.delete({ where: { id: taskId } });
    sendSuccess(res, null, 'Topshiriq o\'chirildi');
  } catch (err) {
    console.error('deleteTask error:', err);
    sendError(res, 'Topshiriqni o\'chirishda xatolik', 500);
  }
};

// PATCH /api/tasks/:id — Topshiriq parametrlarini yangilash (Muddat, Muhimlik, Qayta biriktirish)
export const updateTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';
    const { deadline, priority, assigneeId, note } = req.body;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        assignee: true,
      },
    });

    if (!task) {
      sendError(res, 'Topshiriq topilmadi', 404);
      return;
    }

    const { canManageTasks, isDeptHead } = await getDeptMemberIds(userId, isAdmin);
    const canEdit =
      isAdmin ||
      task.creatorId === userId ||
      isDeptHead ||
      canManageTasks;

    if (!canEdit) {
      sendError(res, 'Ushbu topshiriqni tahrirlash huquqiga ega emassiz', 403);
      return;
    }

    const dataToUpdate: any = {};
    const changes: string[] = [];

    if (deadline) {
      dataToUpdate.deadline = new Date(deadline);
      changes.push(`Muddat o'zgartirildi: ${new Date(deadline).toLocaleDateString('uz-UZ')}`);
    }

    if (priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) {
      dataToUpdate.priority = priority;
      changes.push(`Muhimlik o'zgartirildi: ${priority}`);
    }

    if (assigneeId && Number(assigneeId) !== task.assigneeId) {
      const newAssignee = await prisma.user.findUnique({ where: { id: Number(assigneeId) } });
      if (newAssignee) {
        dataToUpdate.assigneeId = Number(assigneeId);
        changes.push(`Ijrochi qayta biriktirildi: ${newAssignee.fullName}`);
      }
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: dataToUpdate,
      include: {
        creator: { select: { id: true, fullName: true, department: true } },
        assignee: { select: { id: true, fullName: true, department: true } },
      },
    });

    if (changes.length > 0 || note) {
      await prisma.taskActivity.create({
        data: {
          taskId,
          action: 'STATUS_CHANGED',
          description: `${changes.join(', ')}${note ? ` (Izoh: ${note})` : ''}`,
          performedById: userId,
        },
      });
    }

    sendSuccess(res, updatedTask, 'Topshiriq muvaffaqiyatli yangilandi');
  } catch (err) {
    console.error('updateTask error:', err);
    sendError(res, 'Topshiriqni yangilashda xatolik', 500);
  }
};

