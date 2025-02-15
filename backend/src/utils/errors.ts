import { logger } from './logger';

// Base custom error class
export class BaseError extends Error {
  public readonly name: string;
  public readonly httpCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;

  constructor(
    name: string,
    httpCode: number,
    description: string,
    isOperational: boolean,
    context?: Record<string, any>
  ) {
    super(description);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = name;
    this.httpCode = httpCode;
    this.isOperational = isOperational;
    this.context = context;

    Error.captureStackTrace(this);
  }
}

// API Error class for handling HTTP-related errors
export class ApiError extends BaseError {
  constructor(
    code: ErrorCode,
    description: string,
    context?: Record<string, any>
  ) {
    const errorSpec = ErrorSpecs[code];
    super(
      errorSpec.name,
      errorSpec.httpCode,
      description,
      errorSpec.isOperational,
      context
    );
  }
}

// Database-specific error class
export class DatabaseError extends BaseError {
  constructor(
    message: string,
    originalError: any
  ) {
    super(
      'DatabaseError',
      500,
      message,
      true,
      {
        originalError: originalError?.message,
        code: originalError?.code,
        detail: originalError?.detail
      }
    );
  }
}

// Validation error class
export class ValidationError extends BaseError {
  public readonly errors: ValidationErrorDetail[];

  constructor(message: string, errors: ValidationErrorDetail[]) {
    super(
      'ValidationError',
      400,
      message,
      true,
      { errors }
    );
    this.errors = errors;
  }
}

// Contract-specific error class
export class ContractError extends BaseError {
  constructor(
    code: ContractErrorCode,
    description: string,
    context?: Record<string, any>
  ) {
    const errorSpec = ContractErrorSpecs[code];
    super(
      errorSpec.name,
      errorSpec.httpCode,
      description,
      errorSpec.isOperational,
      context
    );
  }
}

// Types and interfaces
export type ErrorCode = keyof typeof ErrorSpecs;
export type ContractErrorCode = keyof typeof ContractErrorSpecs;

export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

export interface ErrorSpec {
  name: string;
  httpCode: number;
  isOperational: boolean;
}

// Error specifications
export const ErrorSpecs: Record<string, ErrorSpec> = {
  INVALID_INPUT: {
    name: 'InvalidInputError',
    httpCode: 400,
    isOperational: true
  },
  UNAUTHORIZED: {
    name: 'UnauthorizedError',
    httpCode: 401,
    isOperational: true
  },
  FORBIDDEN: {
    name: 'ForbiddenError',
    httpCode: 403,
    isOperational: true
  },
  NOT_FOUND: {
    name: 'NotFoundError',
    httpCode: 404,
    isOperational: true
  },
  RATE_LIMIT_EXCEEDED: {
    name: 'RateLimitExceededError',
    httpCode: 429,
    isOperational: true
  },
  INTERNAL_SERVER_ERROR: {
    name: 'InternalServerError',
    httpCode: 500,
    isOperational: false
  },
  SERVICE_UNAVAILABLE: {
    name: 'ServiceUnavailableError',
    httpCode: 503,
    isOperational: true
  }
};

// Contract-specific error specifications
export const ContractErrorSpecs: Record<string, ErrorSpec> = {
  COMPILATION_FAILED: {
    name: 'CompilationError',
    httpCode: 400,
    isOperational: true
  },
  DEPLOYMENT_FAILED: {
    name: 'DeploymentError',
    httpCode: 400,
    isOperational: true
  },
  VERIFICATION_FAILED: {
    name: 'VerificationError',
    httpCode: 400,
    isOperational: true
  },
  OPTIMIZATION_FAILED: {
    name: 'OptimizationError',
    httpCode: 400,
    isOperational: true
  },
  INVALID_BYTECODE: {
    name: 'InvalidBytecodeError',
    httpCode: 400,
    isOperational: true
  },
  SIZE_LIMIT_EXCEEDED: {
    name: 'SizeLimitExceededError',
    httpCode: 400,
    isOperational: true
  }
};

// Error handler function
export const errorHandler = (error: Error): void => {
  if (error instanceof BaseError) {
    if (error.isOperational) {
      logger.warn('Operational error:', {
        name: error.name,
        message: error.message,
        httpCode: error.httpCode,
        context: error.context
      });
    } else {
      logger.error('Programming error:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        context: error.context
      });
    }
  } else {
    logger.error('Unhandled error:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }
};

// Helper functions for common error cases
export const createNotFoundError = (
  resource: string,
  id: string
): ApiError => {
  return new ApiError(
    'NOT_FOUND',
    `${resource} with ID ${id} not found`,
    { resource, id }
  );
};

export const createValidationError = (
  errors: ValidationErrorDetail[]
): ValidationError => {
  return new ValidationError(
    'Validation failed',
    errors
  );
};

export const createAuthenticationError = (
  message: string = 'Authentication required'
): ApiError => {
  return new ApiError(
    'UNAUTHORIZED',
    message
  );
};

export const createForbiddenError = (
  message: string = 'Access denied'
): ApiError => {
  return new ApiError(
    'FORBIDDEN',
    message
  );
};

// Error middleware for Express
export const errorMiddleware = (
  error: Error,
  req: any,
  res: any,
  next: any
): void => {
  errorHandler(error);

  if (error instanceof BaseError) {
    res.status(error.httpCode).json({
      status: 'error',
      code: error.name,
      message: error.message,
      ...(error instanceof ValidationError && { errors: error.errors }),
      ...(error.context && { context: error.context })
    });
  } else {
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred'
    });
  }
};
