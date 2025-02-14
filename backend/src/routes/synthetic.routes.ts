import { Router } from 'express';
import { SyntheticController } from '../controllers/synthetic.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { createAssetSchema, mintAssetSchema } from '../utils/validation';

export function setupSyntheticRoutes(controller: SyntheticController): Router {
  const router = Router();

  router.post(
    '/create',
    authMiddleware,
    rateLimitMiddleware,
    validateRequest(createAssetSchema),
    controller.createAsset.bind(controller)
  );

  router.post(
    '/mint',
    authMiddleware,
    rateLimitMiddleware,
    validateRequest(mintAssetSchema),
    controller.mintAsset.bind(controller)
  );

  router.get(
    '/price/:assetAddress',
    rateLimitMiddleware,
    controller.getAssetPrice.bind(controller)
  );

  return router;
}
