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

# File: /backend/src/routes/contract.routes.ts

import { Router } from 'express';
import { body, param } from 'express-validator';
import { ContractController } from '../controllers/ContractController';
import { asyncHandler } from '../utils/asyncHandler';
import { validateSchema } from '../middleware/validateSchema';

const router = Router();
const controller = new ContractController();

router.post(
    '/create',
    [
        body('name').isString().trim().notEmpty(),
        body('description').optional().isString(),
        body('schema').isObject().notEmpty(),
        body('template').optional().isString(),
        validateSchema
    ],
    asyncHandler(controller.createContract)
);

router.get(
    '/:pubkey',
    [
        param('pubkey').isString().matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        validateSchema
    ],
    asyncHandler(controller.getContract)
);

router.put(
    '/:pubkey/update',
    [
        param('pubkey').isString().matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        body('updates').isObject().notEmpty(),
        validateSchema
    ],
    asyncHandler(controller.updateContract)
);

router.post(
    '/:pubkey/validate',
    [
        param('pubkey').isString().matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        body('data').isObject().notEmpty(),
        validateSchema
    ],
    asyncHandler(controller.validateContract)
);

router.delete(
    '/:pubkey',
    [
        param('pubkey').isString().matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        validateSchema
    ],
    asyncHandler(controller.deleteContract)
);

export default router;

# File: /backend/src/routes/deployment.routes.ts

import { Router } from 'express';
import { body, param } from 'express-validator';
import { DeploymentController } from '../controllers/DeploymentController';
import { asyncHandler } from '../utils/asyncHandler';
import { validateSchema } from '../middleware/validateSchema';
import { validateDeploymentAccess } from '../middleware/validateDeploymentAccess';

const router = Router();
const controller = new DeploymentController();

router.post(
    '/deploy',
    [
        body('contractId').isString().notEmpty(),
        body('network').isIn(['mainnet-beta', 'testnet', 'devnet']),
        body('options').optional().isObject(),
        validateSchema,
        validateDeploymentAccess
    ],
    asyncHandler(controller.deployContract)
);

router.get(
    '/status/:deploymentId',
    [
        param('deploymentId').isString().notEmpty(),
        validateSchema
    ],
    asyncHandler(controller.getDeploymentStatus)
);

router.post(
    '/simulate',
    [
        body('contractId').isString().notEmpty(),
        body('network').isIn(['mainnet-beta', 'testnet', 'devnet']),
        body('options').optional().isObject(),
        validateSchema
    ],
    asyncHandler(controller.simulateDeployment)
);

router.post(
    '/upgrade',
    [
        body('contractId').isString().notEmpty(),
        body('programId').isString().matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        body('network').isIn(['mainnet-beta', 'testnet', 'devnet']),
        body('options').optional().isObject(),
        validateSchema,
        validateDeploymentAccess
    ],
    asyncHandler(controller.upgradeContract)
);

export default router;

# File: /backend/src/routes/validation.routes.ts

import { Router } from 'express';
import { body } from 'express-validator';
import { ValidationController } from '../controllers/ValidationController';
import { asyncHandler } from '../utils/asyncHandler';
import { validateSchema } from '../middleware/validateSchema';

const router = Router();
const controller = new ValidationController();

router.post(
    '/schema',
    [
        body('schema').isObject().notEmpty(),
        validateSchema
    ],
    asyncHandler(controller.validateSchema)
);

router.post(
    '/data',
    [
        body('schema').isObject().notEmpty(),
        body('data').isObject().notEmpty(),
        validateSchema
    ],
    asyncHandler(controller.validateData)
);

router.post(
    '/security',
    [
        body('contractId').isString().notEmpty(),
        body('code').isString().notEmpty(),
        validateSchema
    ],
    asyncHandler(controller.validateSecurity)
);

export default router;

# File: /backend/src/routes/generation.routes.ts

import { Router } from 'express';
import { body } from 'express-validator';
import { GenerationController } from '../controllers/GenerationController';
import { asyncHandler } from '../utils/asyncHandler';
import { validateSchema } from '../middleware/validateSchema';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();
const controller = new GenerationController();

router.post(
    '/contract',
    [
        body('description').isString().notEmpty(),
        body('template').optional().isString(),
        body('options').optional().isObject(),
        validateSchema
    ],
    rateLimiter('ai-generation'),
    asyncHandler(controller.generateContract)
);

router.post(
    '/optimize',
    [
        body('code').isString().notEmpty(),
        body('options').optional().isObject(),
        validateSchema
    ],
    asyncHandler(controller.optimizeContract)
);

router.post(
    '/analyze',
    [
        body('code').isString().notEmpty(),
        body('options').optional().isObject(),
        validateSchema
    ],
    asyncHandler(controller.analyzeContract)
);

export default router;

# File: /backend/src/routes/analytics.routes.ts

import { Router } from 'express';
import { query, param } from 'express-validator';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { asyncHandler } from '../utils/asyncHandler';
import { validateSchema } from '../middleware/validateSchema';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();
const controller = new AnalyticsController();

router.get(
    '/metrics',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        validateSchema
    ],
    cacheMiddleware('metrics', 300),
    asyncHandler(controller.getMetrics)
);

router.get(
    '/contracts/:pubkey/performance',
    [
        param('pubkey').isString().matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        query('period').optional().isIn(['day', 'week', 'month']),
        validateSchema
    ],
    cacheMiddleware('contract-performance', 300),
    asyncHandler(controller.getContractPerformance)
);

router.get(
    '/usage',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('groupBy').optional().isIn(['hour', 'day', 'week', 'month']),
        validateSchema
    ],
    cacheMiddleware('usage-stats', 300),
    asyncHandler(controller.getUsageStats)
);

export default router;
