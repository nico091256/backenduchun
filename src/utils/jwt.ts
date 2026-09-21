import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
}

export const generateAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiresIn as string,
  } as jwt.SignOptions);
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwtRefreshSecret) as JwtPayload;
};

export const getTokenExpiry = (expiresIn: string): Date => {
  const ms =
    expiresIn.endsWith('d')
      ? parseInt(expiresIn) * 24 * 60 * 60 * 1000
      : expiresIn.endsWith('m')
      ? parseInt(expiresIn) * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
};
