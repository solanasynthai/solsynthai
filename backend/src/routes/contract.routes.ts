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
