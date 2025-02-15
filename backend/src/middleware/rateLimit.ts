import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { ErrorWithCode } from '../utils/errors';
import { MetricsService } from '../services/monitoring/MetricsService';
import { logger } from '../utils/logger';
import { config } from '../config';

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
  skipFailedRequests?: boolean;
  handler?: (req: Request, res: Response) => void;
  skip?: (req: Request) => boolean;
  headers?: boolean;
}

export class RateLimitMiddleware {
  private redis: Redis;
  private limiters: Map<string, RateLimiterRedis>;

  constructor() {
    this.redis = new Redis(config.redis.url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3
    });
    this.limiters = new Map();

    this.redis.on('error', (error) => {
      logger.error('Redis rate limit error:', error);
      MetricsService.increment('ratelimit.error', { type: 'redis' });
    });
  }

  private getLimiter(options: RateLimitOptions): RateLimiterRedis {
    const key = options.keyPrefix || 'rl_default';
    
    if (!this.limiters.has(key)) {
      this.limiters.set(key, new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: key,
        points: options.max || 60,
        duration: (options.windowMs || 60000) / 1000,
        blockDuration: 0,
        insuranceLimiter: {
          points: Math.ceil((options.max || 60) * 0.1), // 10% of main limit
          duration: (options.windowMs || 60000) / 1000
        }
      }));
    }

    return this.limiters.get(key)!;
  }

  public rateLimit = (options: RateLimitOptions = {}) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (options.skip?.(req)) {
        return next();
      }

      const limiter = this.getLimiter(options);
      const key = this.getRateLimitKey(req, options);

      try {
        const rateLimitRes = await limiter.consume(key);
        this.setRateLimitHeaders(res, rateLimitRes, options);

        MetricsService.increment('ratelimit.request', {
          path: req.path,
          method: req.method,
          status: 'allowed'
        });

        next();
      } catch (error) {
        if (error instanceof Error) {
          // System error
          logger.error('Rate limit error:', error);
          MetricsService.increment('ratelimit.error', { type: 'system' });
          next(error);
        } else {
          // Rate limit exceeded
          const rateLimitRes = error as RateLimiterRes;
          this.setRateLimitHeaders(res, rateLimitRes, options);

          MetricsService.increment('ratelimit.request', {
            path: req.path,
            method: req.method,
            status: 'blocked'
          });

          if (options.handler) {
            options.handler(req, res);
          } else {
            const retryAfter = Math.ceil(rateLimitRes.msBeforeNext / 1000);
            res.status(429).json({
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests, please try again later',
              retryAfter
            });
          }
        }
      }
    };
  };

  private getRateLimitKey(req: Request, options: RateLimitOptions): string {
    // Default to IP-based rate limiting
    let key = req.ip;

    // If user is authenticated, use user ID
    if (req.user?.id) {
      key = `user:${req.user.id}`;
    }

    // Add path-specific prefix if needed
    if (options.keyPrefix) {
      key = `${options.keyPrefix}:${key}`;
    }

    return key;
  }

  private setRateLimitHeaders(
    res: Response,
    rateLimitRes: RateLimiterRes,
    options: RateLimitOptions
  ): void {
    if (options.headers !== false) {
      res.setHeader('X-RateLimit-Limit', options.max || 60);
      res.setHeader('X-RateLimit-Remaining', rateLimitRes.remainingPoints);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimitRes.msBeforeNext).toISOString());
    }
  }
}

export const rateLimitMiddleware = new RateLimitMiddleware();

// Preset rate limit configurations
export const rateLimitPresets = {
  api: {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    keyPrefix: 'rl_api'
  },
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    keyPrefix: 'rl_auth',
    skipFailedRequests: false
  },
  deployment: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 deployments
    keyPrefix: 'rl_deploy'
  },
  ipStrict: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    keyPrefix: 'rl_ip',
    skip: (req: Request) => !!req.user // Skip if authenticated
  }
};

// Custom rate limiters for specific use cases
export const contractDeploymentLimiter = rateLimitMiddleware.rateLimit({
  ...rateLimitPresets.deployment,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      code: 'DEPLOYMENT_LIMIT_EXCEEDED',
      message: 'You have exceeded the deployment limit. Please try again later.',
      documentation: 'https://docs.solsynthai.com/rate-limits#deployment'
    });
  }
});

export const apiLimiter = rateLimitMiddleware.rateLimit({
  ...rateLimitPresets.api,
  skip: (req: Request) => {
    // Skip rate limiting for internal requests
    return req.ip === '127.0.0.1' || req.ip === '::1';
  }
});

export const authLimiter = rateLimitMiddleware.rateLimit({
  ...rateLimitPresets.auth,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      code: 'AUTH_ATTEMPT_LIMIT',
      message: 'Too many authentication attempts. Please try again later.',
      documentation: 'https://docs.solsynthai.com/rate-limits#auth'
    });
  }
});
