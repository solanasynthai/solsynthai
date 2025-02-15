import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ErrorWithCode } from '../utils/errors';
import { logger } from '../utils/logger';
import { MetricsService } from '../services/monitoring/MetricsService';

interface ValidationOptions {
  stripUnknown?: boolean;
  strict?: boolean;
  async?: boolean;
}

type ValidatedRequest<T> = Request & {
  validatedData: T;
};

export const validate = <T extends AnyZodObject>(
  schema: T,
  options: ValidationOptions = {}
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const mergedData = {
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
        user: req.user
      };

      const startTime = process.hrtime();

      const validatedData = options.async
        ? await schema.parseAsync(mergedData, {
            stripUnknown: options.stripUnknown,
            strict: options.strict
          })
        : schema.parse(mergedData, {
            stripUnknown: options.stripUnknown,
            strict: options.strict
          });

      const [seconds, nanoseconds] = process.hrtime(startTime);
      const validationTime = seconds * 1000 + nanoseconds / 1000000;

      MetricsService.histogram('validation.duration', validationTime, {
        path: req.path,
        method: req.method
      });

      // Type assertion to add validated data to request
      (req as ValidatedRequest<T>).validatedData = validatedData;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = new ErrorWithCode(
          'Validation failed',
          'VALIDATION_ERROR',
          {
            errors: error.errors.map(err => ({
              path: err.path.join('.'),
              message: err.message,
              code: err.code
            }))
          }
        );

        MetricsService.increment('validation.error', {
          path: req.path,
          method: req.method
        });

        logger.warn('Validation error:', {
          path: req.path,
          method: req.method,
          errors: validationError.details
        });

        res.status(400).json({
          code: validationError.code,
          message: validationError.message,
          errors: validationError.details.errors
        });
      } else {
        next(error);
      }
    }
  };
};

// Contract-specific validators
export const validateContractSource = (sourceCode: string): boolean => {
  // Basic validation
  if (!sourceCode || sourceCode.trim().length === 0) {
    return false;
  }

  // Check for required Solana program imports
  const requiredImports = [
    'use solana_program::',
    'use solana_program::{',
    '#[program]'
  ];

  const hasRequiredImports = requiredImports.some(imp => 
    sourceCode.includes(imp)
  );

  if (!hasRequiredImports) {
    return false;
  }

  // Check for potential security issues
  const securityChecks = [
    {
      pattern: /unsafe\s*{/,
      valid: false,
      message: 'Unsafe blocks are not allowed'
    },
    {
      pattern: /asm!\s*{/,
      valid: false,
      message: 'Inline assembly is not allowed'
    },
    {
      pattern: /std::process|std::fs|std::env/,
      valid: false,
      message: 'System-level operations are not allowed'
    }
  ];

  const securityIssues = securityChecks
    .filter(check => check.pattern.test(sourceCode))
    .filter(check => !check.valid);

  if (securityIssues.length > 0) {
    return false;
  }

  return true;
};

// Program ID validator
export const validateProgramId = (programId: string): boolean => {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId);
};

// Organization name validator
export const validateOrganizationName = (name: string): boolean => {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && 
         name.length >= 3 && 
         name.length <= 50;
};

// Custom validators for specific use cases
export const customValidators = {
  isValidSemver: (version: string): boolean => {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+)?$/.test(version);
  },

  isValidNetworkUrl: (url: string): boolean => {
    try {
      new URL(url);
      return url.startsWith('http://') || url.startsWith('https://');
    } catch {
      return false;
    }
  },

  isValidDateRange: (start: Date, end: Date): boolean => {
    return start instanceof Date && 
           end instanceof Date && 
           !isNaN(start.getTime()) && 
           !isNaN(end.getTime()) && 
           start <= end;
  },

  isValidTimeframe: (timeframe: string): boolean => {
    return ['1h', '24h', '7d', '30d'].includes(timeframe);
  }
};

// Error formatters
export const formatValidationError = (error: ZodError): object => {
  return {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    errors: error.errors.map(err => ({
      path: err.path.join('.'),
      message: err.message,
      code: err.code
    }))
  };
};

// Validation middleware factory with caching support
export const createCachedValidation = <T extends AnyZodObject>(
  schema: T,
  options: ValidationOptions & { cacheTTL?: number } = {}
) => {
  const validationCache = new Map<string, any>();

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const cacheKey = JSON.stringify({
        body: req.body,
        query: req.query,
        params: req.params
      });

      if (options.cacheTTL && validationCache.has(cacheKey)) {
        (req as ValidatedRequest<T>).validatedData = validationCache.get(cacheKey);
        return next();
      }

      const validatedData = await validate(schema, options)(req, res, () => {});
      
      if (options.cacheTTL) {
        validationCache.set(cacheKey, validatedData);
        setTimeout(() => {
          validationCache.delete(cacheKey);
        }, options.cacheTTL);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
