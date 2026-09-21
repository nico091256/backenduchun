import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/apiResponse';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('❌ Error:', err);

  if (err.name === 'ValidationError') {
    sendError(res, err.message, 400);
    return;
  }

  if (err.name === 'MulterError') {
    sendError(res, 'Fayl yuklashda xatolik: ' + err.message, 400);
    return;
  }

  if (err.message?.includes('Faqat PDF')) {
    sendError(res, err.message, 400);
    return;
  }

  sendError(res, 'Server xatosi yuz berdi', 500);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  sendError(res, `Yo'l topilmadi: ${req.originalUrl}`, 404);
};
