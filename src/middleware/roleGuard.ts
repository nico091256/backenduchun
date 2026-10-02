import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { sendError } from '../utils/apiResponse';

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Autentifikatsiya talab etiladi', 401);
      return;
    }

    if (!roles.includes(req.user.role)) {
      sendError(res, 'Bu amalni bajarishga ruxsat yo\'q', 403);
      return;
    }

    next();
  };
};

export const requireAdmin = requireRole('ADMIN');
export const requireApprover = requireRole('APPROVER', 'ADMIN', 'EXECUTOR', 'INITIATOR', 'SECRETARY', 'USER');
export const requireInitiator = requireRole('INITIATOR', 'ADMIN', 'EXECUTOR', 'APPROVER', 'SECRETARY', 'USER');

export const requireAdminOrPermission = (permission: import('../utils/permissions').PermissionKey) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      sendError(res, 'Autentifikatsiya talab etiladi', 401);
      return;
    }
    if (req.user.role === 'ADMIN') {
      return next();
    }
    try {
      const { prisma } = await import('../utils/prisma');
      const { hasPermission } = await import('../utils/permissions');
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { role: true, permissions: true },
      });
      if (user && hasPermission(user, permission)) {
        return next();
      }
    } catch (e) {
      console.error('requireAdminOrPermission check error:', e);
    }
    sendError(res, 'Bu amalni bajarishga ruxsat yo\'q', 403);
  };
};


