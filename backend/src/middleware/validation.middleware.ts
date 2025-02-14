import { Request, Response, NextFunction } from 'express';
import { Schema } from 'joi';
import { Logger } from '../utils/logger';

const logger = new Logger('ValidationMiddleware');

export const validateRequest = (schema: Schema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationResult = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (validationResult.error) {
      const errors = validationResult.error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      logger.warn('Validation failed', {
        path: req.path,
        errors
      });

      res.status(400).json({
        success: false,
        errors
      });
      return;
    }

    req.body = validationResult.value;
    next();
  };
};
