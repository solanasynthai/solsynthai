import { Request, Response, NextFunction } from 'express';
import { verify } from '@solana/web3.js';
import bs58 from 'bs58';
import { redisConfig } from '../config/redis.config';
import { Logger } from '../utils/logger';

const logger = new Logger('AuthMiddleware');

interface AuthenticatedRequest extends Request {
  user?: {
    publicKey: string;
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      res.status(401).json({ error: 'No authorization header' });
      return;
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      res.status(401).json({ error: 'Invalid authorization format' });
      return;
    }

    // Check Redis cache for session
    const sessionData = await redisConfig.get(`session:${token}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      req.user = { publicKey: session.publicKey };
      next();
      return;
    }

    // If no cached session, verify signature
    const [message, signature, publicKey] = token.split('.');

    if (!message || !signature || !publicKey) {
      res.status(401).json({ error: 'Invalid token format' });
      return;
    }

    const verified = verify(
      bs58.decode(signature),
      new Uint8Array(Buffer.from(message)),
      bs58.decode(publicKey)
    );

    if (!verified) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Cache the valid session
    await redisConfig.setex(
      `session:${token}`,
      3600, // 1 hour
      JSON.stringify({ publicKey })
    );

    req.user = { publicKey };
    next();
  } catch (error) {
    logger.error('Authentication error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).json({ error: 'Authentication failed' });
  }
}
