import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema, z } from 'zod';
import { ApiError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { MetricsService } from '../../services/monitoring/MetricsService';

const metrics = MetricsService.getInstance();

// Common validation schemas
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const SortSchema = z.object({
  sortBy: z.string(),
  order: z.enum(['asc', 'desc']).default('desc')
});

export const DateRangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
}).refine(
  data => !(data.startDate && data.endDate && data.startDate > data.endDate),
  { message: 'Start date must be before end date' }
);

export function validate<T extends ZodSchema>(
  schema: T,
  location: 'body' | 'query' | 'params' | 'all' = 'body'
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      let dataToValidate: any;

      switch (location) {
        case 'body':
          dataToValidate = req.body;
          break;
        case 'query':
          dataToValidate = req.query;
          break;
        case 'params':
          dataToValidate = req.params;
          break;
        case 'all':
          dataToValidate = {
            body: req.body,
            query: req.query,
            params: req.params
          };
          break;
      }

      const validatedData = await schema.parseAsync(dataToValidate);

      // Replace original data with validated data
      switch (location) {
        case 'body':
          req.body = validatedData;
          break;
        case 'query':
          req.query = validatedData;
          break;
        case 'params':
          req.params = validatedData;
          break;
        case 'all':
          req.body = validatedData.body;
          req.query = validatedData.query;
          req.params = validatedData.params;
          break;
      }

      // Record validation success metrics
      metrics.timing('validation.duration', Date.now() - startTime);
      metrics.increment('validation.success');

      next();
    } catch (error) {
      metrics.increment('validation.error');

      if (error instanceof ZodError) {
        const formattedErrors = formatZodError(error);
        logger.debug('Validation error', { 
          errors: formattedErrors,
          path: req.path
        });

        next(new ApiError('VALIDATION_ERROR', 'Invalid request data', {
          errors: formattedErrors
        }));
      } else {
        next(error);
      }
    }
  };
}

export function validateArrayLimit(
  maxItems: number = 100
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (Array.isArray(req.body)) {
      if (req.body.length > maxItems) {
        next(new ApiError('VALIDATION_ERROR', `Request exceeds maximum of ${maxItems} items`));
        return;
      }
    }
    next();
  };
}

export function sanitizeParams(allowedParams: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.query) {
      const sanitizedQuery: Record<string, unknown> = {};
      
      for (const param of allowedParams) {
        if (req.query[param] !== undefined) {
          sanitizedQuery[param] = req.query[param];
        }
      }
      
      req.query = sanitizedQuery;
    }
    next();
  };
}

export function validateContentType(allowedTypes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'];
    
    if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
      next(new ApiError('VALIDATION_ERROR', 'Invalid content type'));
      return;
    }
    
    next();
  };
}

function formatZodError(error: ZodError) {
  return error.errors.map(err => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code
  }));
}

// Rate limiting schema
export const RateLimitSchema = z.object({
  windowMs: z.number().int().min(1000).default(60000),
  max: z.number().int().min(1).default(100),
  message: z.string().optional(),
  statusCode: z.number().int().min(400).max(500).default(429)
});

// File upload schema
export const FileUploadSchema = z.object({
  maxSize: z.number().int().min(1).max(10485760), // 10MB max
  allowedTypes: z.array(z.string()),
  maxFiles: z.number().int().min(1).max(10).default(1)
});

// Contract validation schemas
export const ContractVersionSchema = z.object({
  major: z.number().int().min(0),
  minor: z.number().int().min(0),
  patch: z.number().int().min(0)
}).transform(({ major, minor, patch }) => `${major}.${minor}.${patch}`);

export const NetworkSchema = z.enum(['mainnet-beta', 'testnet', 'devnet', 'localnet']);

export const PublicKeySchema = z.string().refine(
  (value) => {
    try {
      const { PublicKey } = require('@solana/web3.js');
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid public key' }
);

// Composite schemas for common use cases
export const DeploymentRequestSchema = z.object({
  contractId: z.string().uuid(),
  network: NetworkSchema,
  upgradeAuthority: PublicKeySchema.optional(),
  version: ContractVersionSchema
});

// Error messaging helper
export function getValidationMessage(code: string): string {
  const messages: Record<string, string> = {
    too_small: 'Value is below minimum allowed',
    too_big: 'Value exceeds maximum allowed',
    invalid_type: 'Invalid data type provided',
    invalid_string: 'Invalid string value',
    invalid_date: 'Invalid date format',
    custom: 'Validation failed'
  };

  return messages[code] || 'Validation error occurred';
}

export default {
  validate,
  validateArrayLimit,
  sanitizeParams,
  validateContentType,
  schemas: {
    pagination: PaginationSchema,
    sort: SortSchema,
    dateRange: DateRangeSchema,
    network: NetworkSchema,
    publicKey: PublicKeySchema,
    deployment: DeploymentRequestSchema
  }
};
