import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisConfig } from '../config/redis.config';
import { CONFIG } from '../config';

export const rateLimitMiddleware = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redisConfig.call(...args),
  }),
  windowMs: CONFIG.SECURITY.RATE_LIMIT.WINDOW_MS,
  max: CONFIG.SECURITY.RATE_LIMIT.MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later.'
    });
  },
  keyGenerator: (req) => {
    return req.ip || 'anonymous';
  },
  skip: (req) => {
    // Skip rate limiting for whitelisted IPs
    const whitelist = CONFIG.SECURITY.RATE_LIMIT.WHITELIST || [];
    return whitelist.includes(req.ip || '');
  }
});
