import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { ContractStatus, DeploymentStatus, Network, TimeRange } from '../types';

// Custom validators
const isValidPublicKey = (value: string) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
};

const isValidSolanaAddress = (value: string) => {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
};

// Base schemas
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10)
});

export const DateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime()
}).refine(
  data => new Date(data.startDate) <= new Date(data.endDate),
  { message: 'Start date must be before or equal to end date' }
);

// Auth schemas
export const LoginSchema = z.object({
  publicKey: z.string().refine(isValidPublicKey, {
    message: 'Invalid public key format'
  }),
  signature: z.string().min(1)
});

// Contract schemas
export const CreateContractSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  sourceCode: z.string().min(1),
  visibility: z.enum(['private', 'public', 'organization']).default('private'),
  organizationId: z.string().uuid().optional()
});

export const UpdateContractSchema = CreateContractSchema.partial().omit({
  organizationId: true
});

export const CompileContractSchema = z.object({
  optimize: z.boolean().optional().default(false),
  target: z.enum(['solana']).optional().default('solana')
});

export const ContractQuerySchema = PaginationSchema.extend({
  status: z.nativeEnum(ContractStatus).optional(),
  search: z.string().max(100).optional(),
  authorId: z.string().uuid().optional(),
  visibility: z.enum(['private', 'public', 'organization']).optional()
});

// Deployment schemas
export const CreateDeploymentSchema = z.object({
  contractId: z.string().uuid(),
  network: z.nativeEnum(Network),
  programId: z.string().refine(isValidSolanaAddress, {
    message: 'Invalid program ID format'
  }),
  metadata: z.record(z.unknown()).optional()
});

export const DeploymentQuerySchema = PaginationSchema.extend({
  contractId: z.string().uuid().optional(),
  network: z.nativeEnum(Network).optional(),
  status: z.nativeEnum(DeploymentStatus).optional()
});

// Analytics schemas
export const ContractAnalyticsSchema = DateRangeSchema.extend({
  timeRange: z.nativeEnum(TimeRange).optional().default(TimeRange.DAY)
});

export const SystemMetricsSchema = z.object({
  timeframe: z.enum(['1h', '24h', '7d', '30d']).default('24h')
});

// Organization schemas
export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  websiteUrl: z.string().url().optional(),
  avatarUrl: z.string().url().optional()
});

export const UpdateOrganizationSchema = CreateOrganizationSchema.partial();

export const AddMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member'])
});

// User schemas
export const UpdateProfileSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().optional(),
  avatar: z.instanceof(File).optional()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided'
});

// Utility type generators
export type CreateContractDTO = z.infer<typeof CreateContractSchema>;
export type UpdateContractDTO = z.infer<typeof UpdateContractSchema>;
export type CreateDeploymentDTO = z.infer<typeof CreateDeploymentSchema>;
export type ContractAnalyticsQuery = z.infer<typeof ContractAnalyticsSchema>;
export type SystemMetricsQuery = z.infer<typeof SystemMetricsSchema>;
export type CreateOrganizationDTO = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganizationDTO = z.infer<typeof UpdateOrganizationSchema>;
export type UpdateProfileDTO = z.infer<typeof UpdateProfileSchema>;

// Error messages
export const ValidationMessages = {
  REQUIRED_FIELD: 'This field is required',
  INVALID_FORMAT: 'Invalid format',
  MIN_LENGTH: (min: number) => `Must be at least ${min} characters long`,
  MAX_LENGTH: (max: number) => `Must not exceed ${max} characters`,
  INVALID_EMAIL: 'Invalid email address',
  INVALID_URL: 'Invalid URL format',
  INVALID_DATE_RANGE: 'Invalid date range',
  INVALID_PUBLIC_KEY: 'Invalid public key format',
  INVALID_PROGRAM_ID: 'Invalid program ID format',
  INVALID_NETWORK: 'Invalid network selection',
  INVALID_STATUS: 'Invalid status value',
  INVALID_ROLE: 'Invalid role assignment',
  INVALID_PAGINATION: 'Invalid pagination parameters',
  AT_LEAST_ONE_FIELD: 'At least one field must be provided'
} as const;

// Schema validation middleware factory
export const createValidationMiddleware = (schema: z.ZodSchema) => {
  return async (req: any, res: any, next: any) => {
    try {
      const validData = await schema.parseAsync({
        ...req.body,
        ...req.query,
        ...req.params
      });
      
      // Attach validated data to request
      req.validatedData = validData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          errors: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message
          }))
        });
      } else {
        next(error);
      }
    }
  };
};
