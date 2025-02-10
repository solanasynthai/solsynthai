import { Request, Response, NextFunction } from 'express';
import { ERROR_CODES } from '../../constants';

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid API key'
      }
    });
  }

  next();
};
