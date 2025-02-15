import { Request, Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Redis } from 'ioredis';
import { ApiError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { MetricsService } from '../../services/monitoring/MetricsService';
import { UserService } from '../../services/user/UserService';

const metrics = MetricsService.getInstance();
const userService = UserService.getInstance();
const redis = new Redis(config.redis.url);

declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        walletAddress: string;
        permissions: string[];
        tier: 'free' | 'pro' | 'enterprise';
      };
    }
  }
}

export class AuthMiddleware {
  private static readonly TOKEN_PREFIX = 'Bearer ';
  private static readonly NONCE_PREFIX = 'auth:nonce:';
  private static readonly NONCE_EXPIRY = 300; // 5 minutes
  private static readonly SESSION_EXPIRY = 86400; // 24 hours

  public static authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const startTime = Date.now();

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new ApiError('UNAUTHORIZED', 'No authorization header');
      }

      if (!authHeader.startsWith(AuthMiddleware.TOKEN_PREFIX)) {
        throw new ApiError('UNAUTHORIZED', 'Invalid authorization format');
      }

      const token = authHeader.slice(AuthMiddleware.TOKEN_PREFIX.length);
      const decoded = verify(token, config.jwt.secret) as {
        userId: string;
        walletAddress: string;
      };

      // Get user from cache or database
      const user = await userService.getUserById(decoded.userId);
      if (!user) {
        throw new ApiError('UNAUTHORIZED', 'User not found');
      }

      // Check if token is blacklisted
      const isBlacklisted = await redis.sismember('auth:blacklist', token);
      if (isBlacklisted) {
        throw new ApiError('UNAUTHORIZED', 'Token has been revoked');
      }

      // Attach user to request
      req.user = {
        id: user.id,
        walletAddress: user.walletAddress,
        permissions: user.permissions,
        tier: user.tier
      };

      // Record metrics
      metrics.timing('auth.duration', Date.now() - startTime);
      metrics.increment('auth.success');

      next();
    } catch (error) {
      metrics.increment('auth.error', {
        errorType: error instanceof ApiError ? error.code : 'UNKNOWN'
      });

      if (error instanceof ApiError) {
        next(error);
      } else {
        next(new ApiError('UNAUTHORIZED', 'Authentication failed'));
      }
    }
  };

  public static requirePermissions = (permissions: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const userPermissions = new Set(req.user.permissions);
      
      const hasRequiredPermissions = permissions.every(
        permission => userPermissions.has(permission)
      );

      if (!hasRequiredPermissions) {
        metrics.increment('auth.permission_denied');
        throw new ApiError('FORBIDDEN', 'Insufficient permissions');
      }

      next();
    };
  };

  public static async hasMainnetAccess(userId: string): Promise<boolean> {
    const user = await userService.getUserById(userId);
    return user?.tier === 'enterprise' || 
           user?.permissions.includes('mainnet:deploy');
  }

  public static generateAuthNonce = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { walletAddress } = req.body;

      if (!walletAddress) {
        throw new ApiError('BAD_REQUEST', 'Wallet address is required');
      }

      // Validate wallet address
      try {
        new PublicKey(walletAddress);
      } catch {
        throw new ApiError('BAD_REQUEST', 'Invalid wallet address');
      }

      // Generate nonce
      const nonce = AuthMiddleware.generateNonce();
      const key = `${AuthMiddleware.NONCE_PREFIX}${walletAddress}`;

      // Store nonce with expiration
      await redis.set(key, nonce, 'EX', AuthMiddleware.NONCE_EXPIRY);

      res.json({
        nonce,
        expiresIn: AuthMiddleware.NONCE_EXPIRY
      });

    } catch (error) {
      next(error);
    }
  };

  public static verifySignature = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { walletAddress, signature } = req.body;

      if (!walletAddress || !signature) {
        throw new ApiError('BAD_REQUEST', 'Wallet address and signature are required');
      }

      // Get stored nonce
      const key = `${AuthMiddleware.NONCE_PREFIX}${walletAddress}`;
      const nonce = await redis.get(key);

      if (!nonce) {
        throw new ApiError('BAD_REQUEST', 'Nonce expired or not found');
      }

      // Verify signature
      const messageBytes = new TextEncoder().encode(nonce);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = bs58.decode(walletAddress);

      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes
      );

      if (!isValid) {
        throw new ApiError('UNAUTHORIZED', 'Invalid signature');
      }

      // Delete used nonce
      await redis.del(key);

      // Get or create user
      const user = await userService.getOrCreateUser(walletAddress);

      // Generate JWT
      const token = AuthMiddleware.generateToken(user);

      res.json({
        token,
        expiresIn: AuthMiddleware.SESSION_EXPIRY,
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          tier: user.tier,
          permissions: user.permissions
        }
      });

    } catch (error) {
      next(error);
    }
  };

  private static generateNonce(): string {
    return bs58.encode(nacl.randomBytes(32));
  }

  private static generateToken(user: { id: string; walletAddress: string }): string {
    return require('jsonwebtoken').sign(
      {
        userId: user.id,
        walletAddress: user.walletAddress
      },
      config.jwt.secret,
      { expiresIn: AuthMiddleware.SESSION_EXPIRY }
    );
  }
}
