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

