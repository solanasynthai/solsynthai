import { Router } from 'express';
import { deployContract, getDeploymentStatus } from '../controllers/deploymentController';
import { validateRequest } from '../middleware/validation';

const router = Router();

router.post('/', validateRequest, deployContract);
router.get('/status/:deploymentId', getDeploymentStatus);

export default router;
