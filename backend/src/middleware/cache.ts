import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { logger } from '../utils/logger';
import config from '../config/config';

interface CacheOptions {
  duration?: number;
  keyPrefix?: string;
  ignoreQueryParams?: boolean;
}

class CacheManager {
  private static instance: CacheManager;
  private client: Redis;
  private prefix: string = 'cache:';
  
  private constructor() {
    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      keyPrefix: this.prefix,
      retryStrategy: (times: number) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 200, 1000);
      }
    });

    this.client.on('error', (error) => {
      logger.error('Redis cache error:', { error: error.message });
    });
  }

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  public async get(key: string): Promise<any> {
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      logger.error('Cache get error:', { key, error: error.message });
      return null;
    }
  }

  public async set(key: string, value: any, duration: number): Promise<void> {
    try {
      await this.client.set(
        key,
        JSON.stringify(value),
        'EX',
        duration
      );
    } catch (error) {
      logger.error('Cache set error:', {
        key,
        error: error.message
      });
    }
  }

  public async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error('Cache delete error:', {
        key,
        error: error.message
      });
    }
  }

  public async clear(): Promise<void> {
    try {
      const keys = await this.client.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      logger.error('Cache clear error:', { error: error.message });
    }
  }

  public generateKey(req: Request, keyPrefix?: string): string {
    const parts = [
      keyPrefix || req.baseUrl + req.path,
      req.method
    ];

    // Add query parameters if needed
    const query = req.query;
    if (Object.keys(query).length > 0) {
      parts.push(JSON.stringify(query));
    }

    // Add user context if authenticated
    if (req.user) {
      parts.push(req.user.id);
    }

    return parts.join(':');
  }
}

export const cacheMiddleware = (prefix?: string, duration: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip cache for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const cache = CacheManager.getInstance();
    const key = cache.generateKey(req, prefix);

    try {
      // Attempt to get cached response
      const cachedData = await cache.get(key);
      
      if (cachedData) {
        logger.debug('Cache hit:', { key });
        return res.json(cachedData);
      }

      // Store original json method
      const originalJson = res.json;

      // Override json method to cache the response
      res.json = function(body: any): Response {
        res.json = originalJson;
        cache.set(key, body, duration)
          .catch(error => logger.error('Cache set error:', {
            key,
            error: error.message
          }));
        return originalJson.call(this, body);
      };

      logger.debug('Cache miss:', { key });
      next();
    } catch (error) {
      logger.error('Cache middleware error:', {
        key,
        error: error.message
      });
      next();
    }
  };
};

export const clearCache = async (prefix?: string): Promise<void> => {
  const cache = CacheManager.getInstance();
  if (prefix) {
    const keys = await cache.client.keys(`${cache.prefix}${prefix}:*`);
    if (keys.length > 0) {
      await cache.client.del(...keys);
    }
  } else {
    await cache.clear();
  }
};

export const invalidateCache = async (keys: string[]): Promise<void> => {
  const cache = CacheManager.getInstance();
  for (const key of keys) {
    await cache.delete(key);
  }
};
