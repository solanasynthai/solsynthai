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
