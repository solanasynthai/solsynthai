import { Request, Response, NextFunction } from 'express';
import { ERROR_CODES } from '../../constants';

export interface AppError extends Error {
  code?: string;
  statusCode?: number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err);

  const statusCode = err.statusCode || 500;
  const errorCode = err.code || ERROR_CODES.NETWORK_ERROR;

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: err.message || 'Internal server error'
    }
  });
};
