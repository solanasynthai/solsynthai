import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export const validateRequest = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const validationErrors = errors.array().map(error => ({
            field: error.param,
            message: error.msg,
            value: error.value
        }));

        logger.warn('Request validation failed', {
            method: req.method,
            path: req.path,
            errors: validationErrors
        });

        throw new ValidationError('Request validation failed', {
            errors: validationErrors
        });
    }
    next();
};

export const validateApiKey = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || typeof apiKey !== 'string') {
        logger.warn('Missing API key', {
            method: req.method,
            path: req.path,
            ip: req.ip
        });

        throw new ValidationError('API key is required');
    }

    // Check API key format
    const API_KEY_PATTERN = /^[a-zA-Z0-9-_]{32,64}$/;
    if (!API_KEY_PATTERN.test(apiKey)) {
        logger.warn('Invalid API key format', {
            method: req.method,
            path: req.path,
            ip: req.ip
        });

        throw new ValidationError('Invalid API key format');
    }

    next();
};

export const validateContentType = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const contentType = req.headers['content-type'];
        
        if (!contentType || !contentType.includes('application/json')) {
            logger.warn('Invalid content type', {
                method: req.method,
                path: req.path,
                contentType
            });

            throw new ValidationError('Content-Type must be application/json');
        }
    }
    next();
};

export const validatePagination = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    if (page < 1) {
        throw new ValidationError('Page must be greater than 0');
    }

    if (limit < 1 || limit > 100) {
        throw new ValidationError('Limit must be between 1 and 100');
    }

    req.pagination = { page, limit };
    next();
};

export const validateDateRange = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const { startDate, endDate } = req.query;

    if (startDate) {
        const start = new Date(startDate as string);
        if (isNaN(start.getTime())) {
            throw new ValidationError('Invalid start date format');
        }
        req.query.startDate = start.toISOString();
    }

    if (endDate) {
        const end = new Date(endDate as string);
        if (isNaN(end.getTime())) {
            throw new ValidationError('Invalid end date format');
        }
        req.query.endDate = end.toISOString();

        if (startDate && new Date(startDate as string) > end) {
            throw new ValidationError('Start date must be before end date');
        }
    }

    next();
};

export const validatePublicKey = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const pubkey = req.params.pubkey || req.body.pubkey;

    if (!pubkey) {
        throw new ValidationError('Public key is required');
    }

    try {
        new PublicKey(pubkey);
    } catch {
        throw new ValidationError('Invalid public key format');
    }

    next();
};

export const validateNetworkType = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const { network } = req.body;
    const validNetworks = ['mainnet-beta', 'testnet', 'devnet'];

    if (!network) {
        throw new ValidationError('Network type is required');
    }

    if (!validNetworks.includes(network)) {
        throw new ValidationError('Invalid network type');
    }

    next();
};

export const validateSchemaFormat = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const { schema } = req.body;

    if (!schema || typeof schema !== 'object') {
        throw new ValidationError('Invalid schema format');
    }

    const requiredFields = ['name', 'version', 'fields'];
    for (const field of requiredFields) {
        if (!(field in schema)) {
            throw new ValidationError(`Missing required schema field: ${field}`);
        }
    }

    if (typeof schema.name !== 'string' || !schema.name.trim()) {
        throw new ValidationError('Schema name must be a non-empty string');
    }

    if (typeof schema.version !== 'number' || schema.version < 1) {
        throw new ValidationError('Schema version must be a positive number');
    }

    if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
        throw new ValidationError('Schema must contain at least one field');
    }

    for (const field of schema.fields) {
        if (!field.name || !field.type) {
            throw new ValidationError('Each field must have a name and type');
        }
    }

    next();
};

export const validateRequestBody = (validations: ValidationChain[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        await Promise.all(validations.map(validation => validation.run(req)));
        validateRequest(req, res, next);
    };
};
