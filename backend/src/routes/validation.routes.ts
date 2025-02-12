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
