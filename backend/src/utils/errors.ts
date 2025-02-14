import { logger } from './logger'

export class BaseError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly details: Record<string, any>
  public readonly timestamp: string
  public readonly isOperational: boolean

  constructor(
    message: string,
    code: string,
    status: number = 500,
    details: Record<string, any> = {},
    isOperational: boolean = true
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.status = status
    this.details = details
    this.timestamp = new Date().toISOString()
    this.isOperational = isOperational

    Error.captureStackTrace(this, this.constructor)
    logger.error(this.toString())
  }

  public toString(): string {
    return JSON.stringify({
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    }, null, 2)
  }

  public toJSON(): Record<string, any> {
    return {
      error: {
        name: this.name,
        message: this.message,
        code: this.code,
        status: this.status,
        details: this.details,
        timestamp: this.timestamp
      }
    }
  }
}

export class AIServiceError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'AI_SERVICE_ERROR',
      500,
      details,
      true
    )
  }
}

export class ValidationError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      details,
      true
    )
  }
}

export class AuthenticationError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'AUTHENTICATION_ERROR',
      401,
      details,
      true
    )
  }
}

export class AuthorizationError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'AUTHORIZATION_ERROR',
      403,
      details,
      true
    )
  }
}

export class NotFoundError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'NOT_FOUND_ERROR',
      404,
      details,
      true
    )
  }
}

export class RateLimitError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'RATE_LIMIT_ERROR',
      429,
      details,
      true
    )
  }
}

export class BlockchainError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'BLOCKCHAIN_ERROR',
      503,
      details,
      true
    )
  }
}

export class ContractError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'CONTRACT_ERROR',
      400,
      details,
      true
    )
  }
}

export class TransactionError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'TRANSACTION_ERROR',
      400,
      details,
      true
    )
  }
}

export class DatabaseError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'DATABASE_ERROR',
      503,
      details,
      false
    )
  }
}

export class ConfigurationError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'CONFIGURATION_ERROR',
      500,
      details,
      false
    )
  }
}

export class ServiceUnavailableError extends BaseError {
  constructor(
    message: string,
    details: Record<string, any> = {}
  ) {
    super(
      message,
      'SERVICE_UNAVAILABLE',
      503,
      details,
      true
    )
  }
}

export function isOperationalError(error: Error): boolean {
  if (error instanceof BaseError) {
    return error.isOperational
  }
  return false
}

export function handleError(error: Error): void {
  if (!isOperationalError(error)) {
    logger.error('Non-operational error occurred', {
      error: error.message,
      stack: error.stack,
      name: error.name
    })
    process.exit(1)
  }
}

export function convertToAPIError(error: unknown): BaseError {
  if (error instanceof BaseError) {
    return error
  }

  if (error instanceof Error) {
    return new BaseError(
      error.message,
      'INTERNAL_SERVER_ERROR',
      500,
      {
        originalError: error.name,
        stack: error.stack
      },
      false
    )
  }

  return new BaseError(
    'An unexpected error occurred',
    'UNKNOWN_ERROR',
    500,
    {
      originalError: error
    },
    false
  )
}

export const errorHandler = (
  error: Error,
  includeStack: boolean = process.env.NODE_ENV !== 'production'
): Record<string, any> => {
  const apiError = convertToAPIError(error)
  const response = apiError.toJSON()

  if (includeStack && apiError.stack) {
    response.error.stack = apiError.stack
  }

  return response
}
