import { Router } from 'express';
import contractRoutes from './contracts';
import compilationRoutes from './compilation';
import deploymentRoutes from './deployment';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

router.use('/contracts', rateLimit, contractRoutes);
router.use('/compile', rateLimit, compilationRoutes);
router.use('/deploy', rateLimit, deploymentRoutes);

export default router;
