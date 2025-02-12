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
