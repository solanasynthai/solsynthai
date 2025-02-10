import rateLimit from 'express-rate-limit';
import config from '../../config';

export const rateLimit = rateLimit({
  windowMs: config.security.rateLimitWindow,
  max: config.security.maxRequests,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later'
    }
  }
});
