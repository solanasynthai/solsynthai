import { Router } from 'express';
import { compileContract, optimizeContract } from '../controllers/compilationController';
import { validateRequest } from '../middleware/validation';

const router = Router();

router.post('/', validateRequest, compileContract);
router.post('/optimize', validateRequest, optimizeContract);

export default router;
