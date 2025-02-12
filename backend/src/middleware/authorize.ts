import { Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { AuthenticatedRequest } from './authenticate';
import { AuthorizationError } from '../utils/errors';
import { logger } from '../utils/logger';
import config from '../config/config';

const redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    keyPrefix: 'auth:',
    retryStrategy: (times: number) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
    }
});

export const authorize = (requiredPermissions: string[] = []) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.user) {
                throw new AuthorizationError('User not authenticated');
            }

            const { id: userId, role, sessionId } = req.user;

            // Verify session is still valid
            const sessionValid = await verifySession(sessionId);
            if (!sessionValid) {
                throw new AuthorizationError('Session expired');
            }

            // Check role-based access
            const hasRole = await verifyRole(userId, role, requiredPermissions);
            if (!hasRole) {
                logger.warn('Insufficient role permissions', {
                    userId,
                    role,
                    requiredPermissions
                });
                throw new AuthorizationError('Insufficient permissions');
            }

            // Check specific permissions
            if (requiredPermissions.length > 0) {
                const hasPermissions = await verifyPermissions(userId, requiredPermissions);
                if (!hasPermissions) {
                    logger.warn('Missing required permissions', {
                        userId,
                        requiredPermissions
                    });
                    throw new AuthorizationError('Insufficient permissions');
                }
            }

            // Check resource access if applicable
            if (req.params.resourceId) {
                const hasResourceAccess = await verifyResourceAccess(
                    userId,
                    req.params.resourceId,
                    req.method
                );
                if (!hasResourceAccess) {
                    logger.warn('Resource access denied', {
                        userId,
                        resourceId: req.params.resourceId,
                        method: req.method
                    });
                    throw new AuthorizationError('Resource access denied');
                }
            }

            // Update last activity
            await updateLastActivity(sessionId);

            next();
        } catch (error) {
            if (error instanceof AuthorizationError) {
                throw error;
            }
            logger.error('Authorization error', {
                error: error.message,
                stack: error.stack
            });
            throw new AuthorizationError('Authorization failed');
        }
    };
};

const verifySession = async (sessionId: string): Promise<boolean> => {
    try {
        const session = await redisClient.get(`session:${sessionId}`);
        return !!session;
    } catch (error) {
        logger.error('Session verification failed', {
            sessionId,
            error: error.message
        });
        return false;
    }
};

const verifyRole = async (
    userId: string,
    role: string,
    requiredPermissions: string[]
): Promise<boolean> => {
    try {
        const rolePermissions = await redisClient.smembers(`role:${role}:permissions`);
        return requiredPermissions.every(permission => 
            rolePermissions.includes(permission)
        );
    } catch (error) {
        logger.error('Role verification failed', {
            userId,
            role,
            error: error.message
        });
        return false;
    }
};

const verifyPermissions = async (
    userId: string,
    requiredPermissions: string[]
): Promise<boolean> => {
    try {
        const userPermissions = await redisClient.smembers(`user:${userId}:permissions`);
        return requiredPermissions.every(permission => 
            userPermissions.includes(permission)
        );
    } catch (error) {
        logger.error('Permission verification failed', {
            userId,
            error: error.message
        });
        return false;
    }
};

const verifyResourceAccess = async (
    userId: string,
    resourceId: string,
    method: string
): Promise<boolean> => {
    try {
        const resourceAccess = await redisClient.sismember(
            `resource:${resourceId}:access`,
            userId
        );

        if (!resourceAccess) {
            return false;
        }

        const allowedMethods = await redisClient.smembers(
            `resource:${resourceId}:user:${userId}:methods`
        );

        return allowedMethods.includes(method) || allowedMethods.includes('*');
    } catch (error) {
        logger.error('Resource access verification failed', {
            userId,
            resourceId,
            error: error.message
        });
        return false;
    }
};

const updateLastActivity = async (sessionId: string): Promise<void> => {
    try {
        await redisClient.set(
            `session:${sessionId}:lastActivity`,
            Date.now().toString(),
            'EX',
            config.security.sessionDuration
        );
    } catch (error) {
        logger.error('Failed to update last activity', {
            sessionId,
            error: error.message
        });
    }
};

export const authorizeOwner = (resourceType: string) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.user) {
                throw new AuthorizationError('User not authenticated');
            }

            const resourceId = req.params.id || req.body.id;
            if (!resourceId) {
                throw new AuthorizationError('Resource ID not provided');
            }

            const isOwner = await verifyResourceOwnership(
                req.user.id,
                resourceType,
                resourceId
            );

            if (!isOwner) {
                logger.warn('Resource ownership verification failed', {
                    userId: req.user.id,
                    resourceType,
                    resourceId
                });
                throw new AuthorizationError('Not authorized to access this resource');
            }

            next();
        } catch (error) {
            if (error instanceof AuthorizationError) {
                throw error;
            }
            logger.error('Owner authorization error', {
                error: error.message,
                stack: error.stack
            });
            throw new AuthorizationError('Owner authorization failed');
        }
    };
};

const verifyResourceOwnership = async (
    userId: string,
    resourceType: string,
    resourceId: string
): Promise<boolean> => {
    try {
        const owner = await redisClient.get(`${resourceType}:${resourceId}:owner`);
        return owner === userId;
    } catch (error) {
        logger.error('Resource ownership verification failed', {
            userId,
            resourceType,
            resourceId,
            error: error.message
        });
        return false;
    }
};
