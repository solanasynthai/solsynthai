import { Request, Response, NextFunction } from 'express';
import { verify, sign } from 'jsonwebtoken';
import { Connection, PublicKey } from '@solana/web3.js';
import { Message } from '@solana/web3.js';
import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { MetricsService } from '../services/monitoring/MetricsService';
import { ApiError } from '../utils/errors';

interface AuthenticatedRequest extends Request {
  user?: {
    publicKey: string;
    roles: string[];
    permissions: string[];
    organizationId?: string;
  };
  token?: string;
}

class AuthMiddleware {
  private redis: Redis;
  private connection: Connection;
  private readonly TOKEN_PREFIX = 'auth:token:';
  private readonly NONCE_PREFIX = 'auth:nonce:';
  private readonly TOKEN_EXPIRY = 24 * 60 * 60; // 24 hours
  private readonly NONCE_EXPIRY = 5 * 60; // 5 minutes

  constructor() {
    this.redis = new Redis(config.redis.url);
    this.connection = new Connection(config.solana.networks[config.solana.defaultNetwork]);
  }

  public required = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const token = this.extractToken(req);
      if (!token) {
        throw new ApiError('UNAUTHORIZED', 'Authentication token is required');
      }

      const user = await this.validateToken(token);
      if (!user) {
        throw new ApiError('UNAUTHORIZED', 'Invalid or expired token');
      }

      req.user = user;
      req.token = token;

      // Update metrics
      MetricsService.increment('auth.success', {
        method: 'token',
        userType: user.roles.includes('admin') ? 'admin' : 'user'
      });

      next();
    } catch (error) {
      MetricsService.increment('auth.failure', {
        reason: error.message
      });
      next(error);
    }
  };

  public optional = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const token = this.extractToken(req);
      if (token) {
        const user = await this.validateToken(token);
        if (user) {
          req.user = user;
          req.token = token;
        }
      }
      next();
    } catch (error) {
      // Don't fail on optional auth
      logger.warn('Optional authentication failed:', { error });
      next();
    }
  };

  public requireRole = (roles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        throw new ApiError('UNAUTHORIZED', 'Authentication required');
      }

      const hasRole = roles.some(role => req.user!.roles.includes(role));
      if (!hasRole) {
        throw new ApiError('FORBIDDEN', 'Insufficient permissions');
      }

      next();
    };
  };

  public requirePermission = (permissions: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        throw new ApiError('UNAUTHORIZED', 'Authentication required');
      }

      const hasPermission = permissions.some(permission => 
        req.user!.permissions.includes(permission)
      );
      if (!hasPermission) {
        throw new ApiError('FORBIDDEN', 'Insufficient permissions');
      }

      next();
    };
  };

  public async generateNonce(publicKey: string): Promise<string> {
    const nonce = this.generateRandomString(32);
    const key = `${this.NONCE_PREFIX}${publicKey}`;
    
    await this.redis.setex(key, this.NONCE_EXPIRY, nonce);
    return nonce;
  }

  public async verifySignature(
    publicKey: string,
    signature: string,
    message: string
  ): Promise<boolean> {
    try {
      const key = new PublicKey(publicKey);
      const signatureBuffer = Buffer.from(signature, 'base64');
      const messageBuffer = Buffer.from(message);

      // Create message object
      const messageObj = new Message(messageBuffer);

      // Verify signature
      return true; // Replace with actual signature verification logic

    } catch (error) {
      logger.error('Signature verification failed:', { error });
      return false;
    }
  }

  public async createToken(
    publicKey: string,
    roles: string[] = ['user'],
    permissions: string[] = []
  ): Promise<string> {
    const token = sign(
      {
        publicKey,
        roles,
        permissions,
        timestamp: Date.now()
      },
      config.security.jwtSecret,
      { expiresIn: this.TOKEN_EXPIRY }
    );

    // Store token in Redis for revocation support
    const key = `${this.TOKEN_PREFIX}${token}`;
    await this.redis.setex(key, this.TOKEN_EXPIRY, JSON.stringify({
      publicKey,
      roles,
      permissions
    }));

    return token;
  }

  public async revokeToken(token: string): Promise<void> {
    const key = `${this.TOKEN_PREFIX}${token}`;
    await this.redis.del(key);
  }

  public async revokeAllUserTokens(publicKey: string): Promise<void> {
    const pattern = `${this.TOKEN_PREFIX}*`;
    const keys = await this.redis.keys(pattern);
    
    for (const key of keys) {
      const userData = await this.redis.get(key);
      if (userData) {
        const { publicKey: tokenPublicKey } = JSON.parse(userData);
        if (tokenPublicKey === publicKey) {
          await this.redis.del(key);
        }
      }
    }
  }

  private extractToken(req: Request): string | null {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      return req.headers.authorization.substring(7);
    }
    return null;
  }

  private async validateToken(token: string): Promise<any | null> {
    try {
      // Check if token is revoked
      const key = `${this.TOKEN_PREFIX}${token}`;
      const storedToken = await this.redis.get(key);
      if (!storedToken) {
        return null;
      }

      // Verify JWT
      const decoded = verify(token, config.security.jwtSecret);
      if (typeof decoded === 'string') {
        return null;
      }

      // Update token expiry
      await this.redis.expire(key, this.TOKEN_EXPIRY);

      return JSON.parse(storedToken);
    } catch (error) {
      logger.error('Token validation failed:', { error });
      return null;
    }
  }

  private generateRandomString(length: number): string {
    return Buffer.from(Array.from({ length }, () => 
      Math.floor(Math.random() * 256)
    )).toString('hex');
  }
}

export const authMiddleware = new AuthMiddleware();
