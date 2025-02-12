# File: /backend/src/utils/errors.ts

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly code: string;
    public readonly context?: Record<string, any>;

    constructor(
        message: string,
        statusCode: number,
        code: string = 'INTERNAL_ERROR',
        isOperational: boolean = true,
        context?: Record<string, any>
    ) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.code = code;
        this.context = context;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 400, 'VALIDATION_ERROR', true, context);
    }
}

export class AuthenticationError extends AppError {
    constructor(message: string = 'Authentication failed') {
        super(message, 401, 'AUTHENTICATION_ERROR', true);
    }
}

export class AuthorizationError extends AppError {
    constructor(message: string = 'Unauthorized access') {
        super(message, 403, 'AUTHORIZATION_ERROR', true);
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string) {
        super(`${resource} not found`, 404, 'NOT_FOUND_ERROR', true);
    }
}

export class RateLimitError extends AppError {
    constructor(message: string = 'Rate limit exceeded') {
        super(message, 429, 'RATE_LIMIT_ERROR', true);
    }
}

export class ContractError extends AppError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 400, 'CONTRACT_ERROR', true, context);
    }
}

export class NetworkError extends AppError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 503, 'NETWORK_ERROR', true, context);
    }
}

export class DatabaseError extends AppError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 500, 'DATABASE_ERROR', false, context);
    }
}

export class AIServiceError extends AppError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 503, 'AI_SERVICE_ERROR', true, context);
    }
}

# File: /backend/src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import config from '../config/config';

export const errorHandler = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // Log error
    console.error('Error:', {
        message: error.message,
        stack: config.app.env === 'development' ? error.stack : undefined,
        context: error instanceof AppError ? error.context : undefined
    });

    // Handle AppError instances
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                context: error.context
            }
        });
    }

    // Handle validation errors from express-validator
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: error.message
            }
        });
    }

    // Handle JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            error: {
                code: 'INVALID_TOKEN',
                message: 'Invalid authentication token'
            }
        });
    }

    // Handle Solana Web3.js errors
    if (error.name === 'SolanaJSONRPCError') {
        return res.status(503).json({
            success: false,
            error: {
                code: 'SOLANA_RPC_ERROR',
                message: 'Solana network error'
            }
        });
    }

    // Handle unknown errors
    return res.status(500).json({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: config.app.env === 'development' 
                ? error.message 
                : 'An unexpected error occurred'
        }
    });
};
