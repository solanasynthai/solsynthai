import { Request, Response, NextFunction } from 'express'
import { PoolClient } from 'pg'
import rateLimit from 'express-rate-limit'
import Joi from 'joi'
import { DatabaseService } from '../../services/database/DatabaseService'
import { AuthenticationService } from '../../services/security/AuthenticationService'
import { MetricsService } from '../../services/monitoring/MetricsService'
import { logger, logError } from '../../utils/logger'
import { AuthError, ValidationError } from '../../utils/errors'
import config from '../../config/config'
import { UserRole, AuthenticatedRequest } from '../../types'

const db = DatabaseService.getInstance()
const metrics = MetricsService.getInstance()
const auth = AuthenticationService.getInstance()

// Rate Limiting Middleware
export const rateLimiter = rateLimit({
  windowMs: config.security.rateLimiter.windowMs,
  max: config.security.rateLimiter.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => config.security.ipWhitelist.includes(req.ip),
  handler: (req, res) => {
    metrics.incrementCounter('rate_limit_exceeded_total')
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil(config.security.rateLimiter.windowMs / 1000),
    })
  },
})

// Transaction Middleware
export const withTransaction = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const transactionClient: PoolClient = await db.pool.connect()
  
  try {
    await transactionClient.query('BEGIN')
    res.locals.transactionClient = transactionClient
    
    res.on('finish', async () => {
      if (res.statusCode < 400) {
        await transactionClient.query('COMMIT')
        metrics.incrementCounter('transaction_commits_total')
      } else {
        await transactionClient.query('ROLLBACK')
        metrics.incrementCounter('transaction_rollbacks_total')
      }
      transactionClient.release()
    })
    
    next()
  } catch (error) {
    await transactionClient.query('ROLLBACK')
    transactionClient.release()
    metrics.incrementCounter('transaction_errors_total')
    next(error)
  }
}

// Validation Schemas
export const schemas = {
  user: {
    create: Joi.object({
      username: Joi.string().alphanum().min(3).max(30).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).max(100).required(),
      role: Joi.string().valid(...Object.values(UserRole)),
    }),
    update: Joi.object({
      username: Joi.string().alphanum().min(3).max(30),
      email: Joi.string().email(),
      role: Joi.string().valid(...Object.values(UserRole)),
    }),
  },
  contract: {
    create: Joi.object({
      name: Joi.string().min(1).max(100).required(),
      description: Joi.string().max(1000),
      code: Joi.string().required(),
      securityLevel: Joi.string().required(),
      optimizationLevel: Joi.string().required(),
    }),
    update: Joi.object({
      name: Joi.string().min(1).max(100),
      description: Joi.string().max(1000),
      code: Joi.string(),
      status: Joi.string(),
      securityLevel: Joi.string(),
      optimizationLevel: Joi.string(),
    }),
  },
  auth: {
    login: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    }),
    refresh: Joi.object({
      refreshToken: Joi.string().required(),
    }),
  },
}

// Validation Middleware
export const validate = (schema: Joi.Schema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, { abortEarly: false })
    
    if (error) {
      metrics.incrementCounter('validation_errors_total')
      throw new ValidationError('Invalid request data', {
        details: error.details.map(detail => ({
          message: detail.message,
          path: detail.path,
        })),
      })
    }
    
    next()
  }
}

// Authentication Middleware
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) {
      throw new AuthError('No token provided')
    }

    const decoded = await auth.verifyToken(token)
    ;(req as AuthenticatedRequest).user = decoded.user
    ;(req as AuthenticatedRequest).sessionId = decoded.sessionId

    metrics.incrementCounter('successful_auth_total')
    next()
  } catch (error) {
    metrics.incrementCounter('failed_auth_total')
    next(new AuthError('Authentication failed', { cause: error }))
  }
}

// Role Authorization Middleware
export const authorize = (roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user
    
    if (!roles.includes(user.role)) {
      metrics.incrementCounter('authorization_denied_total')
      throw new AuthError('Insufficient permissions')
    }
    
    metrics.incrementCounter('authorization_granted_total')
    next()
  }
}

// Error Handling Middleware
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logError('API Error', error)
  metrics.incrementCounter('api_errors_total', { type: error.constructor.name })

  if (error instanceof ValidationError) {
    res.status(400).json({
      error: 'Validation Error',
      details: error.details,
    })
    return
  }

  if (error instanceof AuthError) {
    res.status(401).json({
      error: 'Authentication Error',
      message: error.message,
    })
    return
  }

  res.status(500).json({
    error: 'Internal Server Error',
    requestId: req.id,
  })
}

// Request Logging Middleware
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    metrics.recordHistogram('request_duration_seconds', duration / 1000)

    logger.info('API Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
      user: (req as AuthenticatedRequest).user?.id,
    })
  })

  next()
}

// Metrics Middleware
export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  metrics.incrementCounter('http_requests_total', {
    method: req.method,
    path: req.route?.path || 'unknown',
  })

  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    metrics.recordHistogram('http_request_duration_seconds', duration / 1000, {
      method: req.method,
      path: req.route?.path || 'unknown',
      status: res.statusCode.toString(),
    })
  })

  next()
}

export default {
  rateLimiter,
  withTransaction,
  validate,
  authenticate,
  authorize,
  errorHandler,
  requestLogger,
  metricsMiddleware,
  schemas,
}
