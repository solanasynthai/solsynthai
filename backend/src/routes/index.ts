import { Router } from 'express';
import contractRoutes from './contract.routes';
import deploymentRoutes from './deployment.routes';
import validationRoutes from './validation.routes';
import generationRoutes from './generation.routes';
import analyticsRoutes from './analytics.routes';
import { validateRequest } from '../middleware/validateRequest';
import { rateLimiter } from '../middleware/rateLimiter';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

// API version prefix
const API_VERSION = '/v1';

// Contract routes
router.use(
    `${API_VERSION}/contracts`,
    rateLimiter('contracts'),
    validateRequest,
    contractRoutes
);

// Deployment routes
router.use(
    `${API_VERSION}/deploy`,
    rateLimiter('deployment'),
    validateRequest,
    deploymentRoutes
);

// Validation routes
router.use(
    `${API_VERSION}/validate`,
    rateLimiter('validation'),
    validateRequest,
    validationRoutes
);

// Generation routes
router.use(
    `${API_VERSION}/generate`,
    rateLimiter('generation'),
    validateRequest,
    generationRoutes
);

// Analytics routes
router.use(
    `${API_VERSION}/analytics`,
    rateLimiter('analytics'),
    validateRequest,
    cacheMiddleware('analytics'),
    analyticsRoutes
);

export default router;
