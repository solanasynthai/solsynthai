import { Request, Response, NextFunction } from 'express'
import { validationResult } from 'express-validator'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { AuthenticationService } from '../../services/security/AuthenticationService'
import { MetricsService } from '../../services/monitoring/MetricsService'
import { CacheService } from '../../services/cache/CacheService'
import { AuthenticationError, ValidationError } from '../../utils/errors'
import { logger, logError } from '../../utils/logger'
import config from '../../config/config'

const auth = AuthenticationService.getInstance()
const metrics = MetricsService.getInstance()
const cache = CacheService.getInstance()

// Security middleware
export const security = [
  helmet({
    contentSecurityPolicy: config.security_headers.cspEnabled ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", config.solana.rpcUrl],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    } : false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    hidePoweredBy: true,
    xssFilter: true
  }),
  cors({
    origin: config.app.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // 24 hours
  })
]

// Authentication middleware
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = performance.now()

  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      throw new AuthenticationError('No authorization header')
    }

    const [type, token] = authHeader.split(' ')
    if (type !== 'Bearer' || !token) {
      throw new AuthenticationError('Invalid authorization header')
    }

    const payload = await auth.validateToken(token)
    req.user = payload

    metrics.gauge('auth_middleware_duration', performance.now() - startTime)
    next()

  } catch (error) {
    metrics.increment('auth_failures_total')
    logError('Authentication failed', error as Error)
    next(error)
  }
}

// Request validation middleware
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    throw new ValidationError('Invalid request parameters', {
      errors: errors.array()
    })
  }
  next()
}

// Rate limiting middleware factory
export const createRateLimiter = (options: {
  windowMs: number
  max: number
  keyGenerator?: (req: Request) => string
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    keyGenerator: options.keyGenerator || ((req) => req.ip),
    handler: (req, res) => {
      metrics.increment('rate_limit_exceeded_total')
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil(options.windowMs / 1000)
      })
    },
    skip: (req) => req.method === 'OPTIONS'
  })
}

// Request logging middleware
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = performance.now()

  res.on('finish', () => {
    const duration = performance.now() - startTime
    const status = res.statusCode

    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      status,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent')
    })

    metrics.gauge('http_request_duration', duration)
    metrics.increment('http_requests_total', {
      method: req.method,
      path: req.path,
      status: status.toString()
    })
  })

  next()
}

// Error handling middleware
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logError('Request error', error)

  metrics.increment('errors_total', {
    type: error.constructor.name
  })

  if (error instanceof ValidationError) {
    res.status(400).json({
      error: 'Validation Error',
      details: error.details
    })
    return
  }

  if (error instanceof AuthenticationError) {
    res.status(401).json({
      error: 'Authentication Error',
      message: error.message
    })
    return
  }

  // Generic error response
  res.status(500).json({
    error: 'Internal Server Error',
    requestId: req.id
  })
}

// Cache middleware factory
export const cacheMiddleware = (options: {
  duration: number
  key?: (req: Request) => string
}) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (req.method !== 'GET') {
      next()
      return
    }

    const key = options.key?.(req) || `cache:${req.originalUrl}`

    try {
      const cached = await cache.get(key)
      if (cached) {
        metrics.increment('cache_hits_total')
        res.json(cached)
        return
      }

      const originalJson = res.json.bind(res)
      res.json = (body: any) => {
        cache.set(key, body, options.duration)
          .catch(error => logError('Cache set failed', error))
        return originalJson(body)
      }

      metrics.increment('cache_misses_total')
      next()

    } catch (error) {
      logError('Cache middleware error', error as Error)
      next()
    }
  }
}

// Request ID middleware
export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  req.id = require('crypto').randomBytes(16).toString('hex')
  res.setHeader('X-Request-ID', req.id)
  next()
}

// Response time header middleware
export const responseTime = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = process.hrtime()

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(startTime)
    const duration = seconds * 1000 + nanoseconds / 1000000
    res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`)
  })

  next()
}

// Compression middleware configuration
export const compressionOptions = {
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) {
      return false
    }
    return true
  },
  threshold: 1024 // 1KB
}

// Export all middlewares
export default {
  security,
  authenticate,
  validateRequest,
  createRateLimiter,
  requestLogger,
  errorHandler,
  cacheMiddleware,
  requestId,
  responseTime,
  compressionOptions
}
