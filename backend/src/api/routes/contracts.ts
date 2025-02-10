import { Router } from 'express';
import { generateContract, validateContract, getTemplates } from '../controllers/contractController';
import { validateRequest } from '../middleware/validation';

const router = Router();

router.post('/generate', validateRequest, generateContract);
router.post('/validate', validateRequest, validateContract);
router.get('/templates', getTemplates);

export default router;
