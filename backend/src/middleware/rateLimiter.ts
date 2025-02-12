import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';
import config from '../config/config';

const redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => {
        if (times > 3) {
            return null;
        }
        return Math.min(times * 200, 1000);
    }
});

redisClient.on('error', (error) => {
    logger.error('Redis client error', { error: error.message });
});

const rateLimiters: { [key: string]: RateLimiterRedis } = {
    default: new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: 'ratelimit_default',
        points: 100,
        duration: 60,
        blockDuration: 60,
        insuranceLimiter: new RateLimiterRedis({
            storeClient: redisClient,
            keyPrefix: 'insurance_default',
            points: 10,
            duration: 60,
            blockDuration: 60
        })
    }),
    contracts: new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: 'ratelimit_contracts',
        points: 50,
        duration: 60,
        blockDuration: 120
    }),
    deployment: new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: 'ratelimit_deployment',
        points: 20,
        duration: 60,
        blockDuration: 300
    }),
    generation: new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: 'ratelimit_generation',
        points: 30,
        duration: 60,
        blockDuration: 180
    }),
    analytics: new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: 'ratelimit_analytics',
        points: 200,
        duration: 60,
        blockDuration: 30
    })
};

interface RateLimitInfo {
    remaining: number;
    reset: Date;
    total: number;
}

export const rateLimiter = (type: keyof typeof rateLimiters = 'default') => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const limiter = rateLimiters[type] || rateLimiters.default;
        const key = req.ip;

        try {
            const rateLimitInfo = await limiter.consume(key);
            
            // Set rate limit headers
            setRateLimitHeaders(res, {
                remaining: rateLimitInfo.remainingPoints,
                reset: new Date(Date.now() + rateLimitInfo.msBeforeNext),
                total: limiter.points
            });

            // Log rate limit status
            logger.debug('Rate limit status', {
                type,
                ip: key,
                remaining: rateLimitInfo.remainingPoints,
                reset: new Date(Date.now() + rateLimitInfo.msBeforeNext)
            });

            next();
        } catch (error) {
            if (error instanceof Error) {
                // Check if it's a rate limit error
                if (error.name === 'Error' && error.message.includes('Too Many Requests')) {
                    const retryAfter = Math.floor(error.msBeforeNext / 1000) || 60;

                    setRateLimitHeaders(res, {
                        remaining: 0,
                        reset: new Date(Date.now() + (retryAfter * 1000)),
                        total: limiter.points
                    });

                    logger.warn('Rate limit exceeded', {
                        type,
                        ip: key,
                        retryAfter
                    });

                    throw new RateLimitError(`Rate limit exceeded. Please try again in ${retryAfter} seconds.`);
                }
            }
            
            // For other errors, log and rethrow
            logger.error('Rate limiter error', {
                type,
                ip: key,
                error: error.message
            });
            
            throw error;
        }
    };
};

function setRateLimitHeaders(res: Response, info: RateLimitInfo): void {
    res.setHeader('X-RateLimit-Limit', info.total.toString());
    res.setHeader('X-RateLimit-Remaining', info.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(info.reset.getTime() / 1000).toString());
}

export const getRateLimitInfo = async (ip: string, type: string = 'default'): Promise<RateLimitInfo> => {
    const limiter = rateLimiters[type] || rateLimiters.default;
    try {
        const result = await limiter.get(ip);
        return {
            remaining: result ? limiter.points - result.consumedPoints : limiter.points,
            reset: new Date(Date.now() + (result ? result.msBeforeNext : 0)),
            total: limiter.points
        };
    } catch (error) {
        logger.error('Error getting rate limit info', {
            type,
            ip,
            error: error.message
        });
        throw error;
    }
};

export const clearRateLimit = async (ip: string, type: string = 'default'): Promise<void> => {
    const limiter = rateLimiters[type] || rateLimiters.default;
    try {
        await limiter.delete(ip);
        logger.info('Rate limit cleared', { type, ip });
    } catch (error) {
        logger.error('Error clearing rate limit', {
            type,
            ip,
            error: error.message
        });
        throw error;
    }
};

// Monitor rate limiter metrics
setInterval(async () => {
    try {
        for (const [type, limiter] of Object.entries(rateLimiters)) {
            const keys = await redisClient.keys(`${limiter.keyPrefix}:*`);
            const blockedCount = keys.length;
            
            logger.info('Rate limiter metrics', {
                type,
                blockedCount,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        logger.error('Error collecting rate limiter metrics', {
            error: error.message
        });
    }
}, 60000); // Every minute
