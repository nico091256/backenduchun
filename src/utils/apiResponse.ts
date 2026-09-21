import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
  errors?: unknown[];
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message = 'Muvaffaqiyatli',
  statusCode = 200,
  meta?: ApiResponse['meta']
): Response => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta && { meta }),
  });
};

export const sendError = (
  res: Response,
  message: string,
  statusCode = 500,
  errors?: unknown[]
): Response => {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
  });
};

export const sendCreated = <T>(res: Response, data: T, message = 'Yaratildi'): Response => {
  return sendSuccess(res, data, message, 201);
};
