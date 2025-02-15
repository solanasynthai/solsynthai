import { Router } from 'express';
import { z } from 'zod';
import { AuthMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { AIGenerationService } from '../../services/ai/AIGenerationService';
import { RateLimiter } from '../../utils/rateLimiter';
import { ApiError } from '../../utils/errors';
import { MetricsService } from '../../services/monitoring/MetricsService';
import { ContractCache } from '../../services/cache/ContractCache';
import { logger } from '../../utils/logger';
import type { GenerationOptions, ContractTemplate } from '../../types/contracts';

const router = Router();
const aiService = AIGenerationService.getInstance();
const metrics = MetricsService.getInstance();
const cache = ContractCache.getInstance();

// Rate limiting: 20 requests per minute per user
const rateLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user.id
});

const GenerateContractSchema = z.object({
  prompt: z.string().min(10).max(2000),
  projectName: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  contractType: z.enum(['token', 'nft', 'marketplace', 'staking', 'custom']),
  options: z.object({
    includeTests: z.boolean().default(true),
    optimization: z.enum(['speed', 'size', 'balanced']).default('balanced'),
    solanaVersion: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.17.0'),
    features: z.array(z.string()).optional(),
    security: z.object({
      auditLevel: z.enum(['basic', 'standard', 'comprehensive']).default('standard'),
      includeAuditReport: z.boolean().default(true)
    }).optional()
  }).default({})
});

router.post('/generate',
  AuthMiddleware.authenticate,
  rateLimiter.check(),
  validate(GenerateContractSchema),
  async (req, res, next) => {
    const startTime = Date.now();
    const { prompt, projectName, contractType, options } = req.body;
    const userId = req.user.id;

    try {
      const cacheKey = `contract:${userId}:${projectName}:${prompt.slice(0, 50)}`;
      const cachedResult = await cache.get(cacheKey);

      if (cachedResult) {
        metrics.increment('contract_generation.cache_hit', { contractType });
        return res.json(JSON.parse(cachedResult));
      }

      const generationOptions: GenerationOptions = {
        security: options.security?.auditLevel || 'standard',
        optimization: options.optimization,
        testing: options.includeTests,
        features: options.features || [],
        solanaVersion: options.solanaVersion
      };

      logger.info('Generating contract', {
        userId,
        projectName,
        contractType,
        options: generationOptions
      });

      const result = await aiService.generateContract(prompt, generationOptions);

      // Validate generated contract
      await validateGeneratedContract(result.template);

      // Cache successful result
      await cache.set(cacheKey, JSON.stringify(result), 3600); // Cache for 1 hour

      // Record metrics
      metrics.timing('contract_generation.duration', Date.now() - startTime, { contractType });
      metrics.increment('contract_generation.success', { contractType });

      res.json({
        success: true,
        data: result,
        meta: {
          generationTime: Date.now() - startTime,
          projectName,
          contractType
        }
      });

    } catch (error) {
      metrics.increment('contract_generation.error', {
        contractType,
        errorType: error instanceof ApiError ? error.code : 'UNKNOWN'
      });

      logger.error('Contract generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        projectName,
        contractType
      });

      next(error);
    }
  }
);

router.get('/templates',
  AuthMiddleware.authenticate,
  async (_req, res) => {
    const templates = await cache.getTemplates();
    res.json({ templates });
  }
);

router.get('/status/:contractId',
  AuthMiddleware.authenticate,
  async (req, res, next) => {
    try {
      const contractId = req.params.contractId;
      const status = await aiService.getGenerationStatus(contractId);
      
      if (!status) {
        throw new ApiError('CONTRACT_NOT_FOUND', 'Contract generation not found');
      }

      res.json({ status });
    } catch (error) {
      next(error);
    }
  }
);

async function validateGeneratedContract(template: ContractTemplate) {
  const validationErrors: string[] = [];

  // Validate basic structure
  if (!template.name || !template.version || !template.schemas || !template.instructions) {
    throw new ApiError('INVALID_CONTRACT', 'Generated contract is missing required fields');
  }

  // Validate schemas
  if (!Array.isArray(template.schemas) || template.schemas.length === 0) {
    validationErrors.push('Contract must include at least one schema');
  }

  // Validate instructions
  if (!Array.isArray(template.instructions) || template.instructions.length === 0) {
    validationErrors.push('Contract must include at least one instruction');
  }

  // Check for security patterns
  const securityPatterns = [
    'ownership',
    'inputValidation',
    'reentrancyGuard'
  ];

  const missingPatterns = securityPatterns.filter(pattern => 
    !template.metadata?.security?.includes(pattern)
  );

  if (missingPatterns.length > 0) {
    validationErrors.push(`Missing security patterns: ${missingPatterns.join(', ')}`);
  }

  if (validationErrors.length > 0) {
    throw new ApiError('INVALID_CONTRACT', 'Contract validation failed', {
      errors: validationErrors
    });
  }
}

export default router;
