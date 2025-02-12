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
