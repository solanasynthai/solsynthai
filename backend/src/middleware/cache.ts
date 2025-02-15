import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { ErrorWithCode } from '../utils/errors';
import { MetricsService } from '../services/monitoring/MetricsService';
import { logger } from '../utils/logger';
import { config } from '../config';

interface CacheOptions {
  ttl?: number;
  key?: string | ((req: Request) => string);
  condition?: (req: Request) => boolean;
  invalidateOn?: {
    paths: string[];
    methods: string[];
  };
  compress?: boolean;
  staleWhileRevalidate?: number;
}

export class CacheMiddleware {
  private redis: Redis;
  private readonly prefix: string = 'cache:';
  private readonly defaultTTL: number = 300; // 5 minutes

  constructor() {
    this.redis = new Redis(config.redis.url, {
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3
    });

    this.redis.on('error', (error) => {
      logger.error('Redis cache error:', error);
      MetricsService.increment('cache.error', { type: 'redis' });
    });
  }

  public cache = (options: CacheOptions = {}) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || (options.condition && !options.condition(req))) {
        return next();
      }

      const cacheKey = this.getCacheKey(req, options.key);
      const startTime = process.hrtime();

      try {
        const cachedResponse = await this.redis.get(cacheKey);

        if (cachedResponse) {
          const [seconds, nanoseconds] = process.hrtime(startTime);
          const duration = seconds * 1000 + nanoseconds / 1000000;

          MetricsService.histogram('cache.hit.duration', duration, {
            path: req.path,
            method: req.method
          });

          const parsed = JSON.parse(cachedResponse);
          
          // Check if we need to revalidate in background
          if (options.staleWhileRevalidate) {
            const metadata = await this.redis.get(`${cacheKey}:metadata`);
            if (metadata) {
              const { timestamp } = JSON.parse(metadata);
              const age = Date.now() - timestamp;
              if (age > (options.ttl || this.defaultTTL) * 1000) {
                this.revalidateCache(req, options, cacheKey).catch(error => {
                  logger.error('Cache revalidation error:', error);
                });
              }
            }
          }

          res.set('X-Cache', 'HIT');
          return res.json(parsed);
        }

        // Store original res.json to intercept response
        const originalJson = res.json.bind(res);
        res.json = (body: any): Response => {
          const responseTime = process.hrtime(startTime);
          const duration = responseTime[0] * 1000 + responseTime[1] / 1000000;

          MetricsService.histogram('cache.miss.duration', duration, {
            path: req.path,
            method: req.method
          });

          this.setCacheResponse(cacheKey, body, options).catch(error => {
            logger.error('Cache set error:', error);
          });

          res.set('X-Cache', 'MISS');
          return originalJson(body);
        };

        next();
      } catch (error) {
        logger.error('Cache middleware error:', error);
        MetricsService.increment('cache.error', {
          path: req.path,
          method: req.method
        });
        next();
      }
    };
  };

  public invalidateCache = (options: CacheOptions = {}) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!options.invalidateOn) {
        return next();
      }

      const { paths, methods } = options.invalidateOn;
      
      if (
        paths.includes(req.path) && 
        methods.includes(req.method)
      ) {
        try {
          const pattern = this.getCacheKeyPattern(req, options.key);
          const keys = await this.redis.keys(pattern);
          
          if (keys.length > 0) {
            await this.redis.del(...keys);
            
            MetricsService.increment('cache.invalidate', {
              path: req.path,
              method: req.method,
              count: keys.length.toString()
            });
          }
        } catch (error) {
          logger.error('Cache invalidation error:', error);
          MetricsService.increment('cache.error', { type: 'invalidation' });
        }
      }

      next();
    };
  };

  private getCacheKey(req: Request, keyOption?: string | ((req: Request) => string)): string {
    if (typeof keyOption === 'function') {
      return this.prefix + keyOption(req);
    }

    if (typeof keyOption === 'string') {
      return this.prefix + keyOption;
    }

    const hash = createHash('sha256');
    hash.update(req.originalUrl);
    
    if (req.user) {
      hash.update(req.user.id);
    }

    return this.prefix + hash.digest('hex');
  }

  private getCacheKeyPattern(req: Request, keyOption?: string | ((req: Request) => string)): string {
    if (typeof keyOption === 'function') {
      return this.prefix + keyOption(req) + '*';
    }

    if (typeof keyOption === 'string') {
      return this.prefix + keyOption + '*';
    }

    return this.prefix + '*';
  }

  private async setCacheResponse(
    key: string,
    body: any,
    options: CacheOptions
  ): Promise<void> {
    const ttl = options.ttl || this.defaultTTL;
    const value = JSON.stringify(body);

    const multi = this.redis.multi();

    multi.set(key, value, 'EX', ttl);

    if (options.staleWhileRevalidate) {
      multi.set(
        `${key}:metadata`,
        JSON.stringify({ timestamp: Date.now() }),
        'EX',
        ttl + options.staleWhileRevalidate
      );
    }

    await multi.exec();

    MetricsService.increment('cache.set', {
      ttl: ttl.toString()
    });
  }

  private async revalidateCache(
    req: Request,
    options: CacheOptions,
    cacheKey: string
  ): Promise<void> {
    try {
      const response = await fetch(req.originalUrl, {
        headers: req.headers as HeadersInit
      });

      if (!response.ok) {
        throw new Error(`Revalidation failed: ${response.statusText}`);
      }

      const body = await response.json();
      await this.setCacheResponse(cacheKey, body, options);

      MetricsService.increment('cache.revalidate.success', {
        path: req.path
      });
    } catch (error) {
      MetricsService.increment('cache.revalidate.error', {
        path: req.path
      });
      throw error;
    }
  }
}

export const cacheMiddleware = new CacheMiddleware();

// Preset cache configurations
export const cachePresets = {
  shortTerm: {
    ttl: 60, // 1 minute
    staleWhileRevalidate: 300 // 5 minutes
  },
  mediumTerm: {
    ttl: 300, // 5 minutes
    staleWhileRevalidate: 900 // 15 minutes
  },
  longTerm: {
    ttl: 3600, // 1 hour
    staleWhileRevalidate: 7200 // 2 hours
  },
  static: {
    ttl: 86400, // 24 hours
    condition: (req: Request) => req.path.startsWith('/static/')
  }
};
