import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PublicKey } from '@solana/web3.js';
import { encode as base58Encode, decode as base58Decode } from 'bs58';
import { verify } from 'tweetnacl';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { Redis } from 'ioredis';
import config from '../config/config';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        pubkey: string;
        role: string;
        permissions: string[];
        sessionId: string;
    };
}

const redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    keyPrefix: 'auth:'
});

export const authenticate = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Extract token
        const token = extractToken(req);
        if (!token) {
            throw new AuthenticationError('No authentication token provided');
        }

        // Verify token
        const decoded = await verifyToken(token);

        // Check token in blacklist
        const isBlacklisted = await checkTokenBlacklist(token);
        if (isBlacklisted) {
            throw new AuthenticationError('Token has been revoked');
        }

        // Validate session
        const sessionValid = await validateSession(decoded.sessionId);
        if (!sessionValid) {
            throw new AuthenticationError('Session has expired');
        }

        // Get user permissions
        const permissions = await getUserPermissions(decoded.id);

        // Attach user to request
        req.user = {
            id: decoded.id,
            pubkey: decoded.pubkey,
            role: decoded.role,
            permissions,
            sessionId: decoded.sessionId
        };

        // Log authentication
        logger.info('User authenticated', {
            userId: decoded.id,
            pubkey: decoded.pubkey,
            sessionId: decoded.sessionId
        });

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            throw new AuthenticationError('Invalid token');
        }
        if (error instanceof jwt.TokenExpiredError) {
            throw new AuthenticationError('Token has expired');
        }
        throw error;
    }
};

export const authenticateWallet = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { signature, pubkey, message } = req.body;

        if (!signature || !pubkey || !message) {
            throw new AuthenticationError('Missing signature details');
        }

        // Verify signature
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = base58Decode(signature);
        const publicKeyBytes = new PublicKey(pubkey).toBytes();

        const isValid = verify(messageBytes, signatureBytes, publicKeyBytes);
        if (!isValid) {
            throw new AuthenticationError('Invalid signature');
        }

        // Get or create user
        const user = await getUserByPublicKey(pubkey);
        if (!user) {
            throw new AuthenticationError('User not found');
        }

        // Create session
        const sessionId = await createSession(user.id);

        // Generate token
        const token = generateToken({
            id: user.id,
            pubkey: user.pubkey,
            role: user.role,
            sessionId
        });

        // Attach user to request
        req.user = {
            id: user.id,
            pubkey: user.pubkey,
            role: user.role,
            permissions: user.permissions,
            sessionId
        };

        // Set token in response
        res.setHeader('Authorization', `Bearer ${token}`);

        next();
    } catch (error) {
        throw new AuthenticationError('Wallet authentication failed');
    }
};

const extractToken = (req: Request): string | null => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : null;
};

const verifyToken = async (token: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        jwt.verify(token, config.security.jwtSecret, {
            algorithms: ['HS256']
        }, (err, decoded) => {
            if (err) reject(err);
            resolve(decoded);
        });
    });
};

const checkTokenBlacklist = async (token: string): Promise<boolean> => {
    const blacklisted = await redisClient.get(`blacklist:${token}`);
    return !!blacklisted;
};

const validateSession = async (sessionId: string): Promise<boolean> => {
    const session = await redisClient.get(`session:${sessionId}`);
    return !!session;
};

const getUserPermissions = async (userId: string): Promise<string[]> => {
    const permissions = await redisClient.smembers(`permissions:${userId}`);
    return permissions;
};

const createSession = async (userId: string): Promise<string> => {
    const sessionId = generateSessionId();
    await redisClient.set(
        `session:${sessionId}`,
        userId,
        'EX',
        config.security.sessionDuration
    );
    return sessionId;
};

const generateToken = (payload: any): string => {
    return jwt.sign(payload, config.security.jwtSecret, {
        expiresIn: config.security.jwtExpiresIn,
        algorithm: 'HS256'
    });
};

const generateSessionId = (): string => {
    return crypto.randomUUID();
};

const getUserByPublicKey = async (pubkey: string): Promise<any> => {
    const userJson = await redisClient.get(`user:${pubkey}`);
    return userJson ? JSON.parse(userJson) : null;
};
