import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt';
import { sendError } from '../utils/apiResponse';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Kirish taqiqlangan. Token topilmadi.', 401);
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    sendError(res, 'Yaroqsiz yoki muddati tugagan token.', 401);
  }
};

export const authenticateFileAccess = (req: AuthRequest, res: Response, next: NextFunction): void => {
  // Avatarlar yoki ommaviy profil rasmlari uchun erkin kirish
  if (req.path.startsWith('/avatars/') || req.path.includes('avatar-') || req.path.includes('default-avatar')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token as string;
  }

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Faylga kirish rad etildi. Tizimga kirish talab etiladi.',
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Yaroqsiz yoki muddati tugagan sessiya tokeni.',
    });
  }
};


