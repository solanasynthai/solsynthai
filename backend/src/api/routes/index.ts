import { Router } from 'express'
import { body, param, query } from 'express-validator'
import { AuthenticationService } from '../../services/security/AuthenticationService'
import { AIGenerationService } from '../../services/ai/AIGenerationService'
import { ContractAnalyzer } from '../../services/analysis/ContractAnalyzer'
import { MetricsService } from '../../services/monitoring/MetricsService'
import { validateRequest, authenticate, rateLimit } from '../middlewares'
import { logger } from '../../utils/logger'
import config from '../../config/config'

const router = Router()
const auth = AuthenticationService.getInstance()
const ai = AIGenerationService.getInstance()
const analyzer = ContractAnalyzer.getInstance()
const metrics = MetricsService.getInstance()

// Authentication routes
router.post(
  '/auth/login',
  [
    body('username').trim().isString().notEmpty(),
    body('password').isString().isLength({ min: 8 }),
    validateRequest,
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5 // limit each IP to 5 requests per windowMs
    })
  ],
  async (req, res, next) => {
    try {
      const { username, password } = req.body
      const result = await auth.authenticate(
        username,
        password,
        req.ip
      )
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

router.post(
  '/auth/refresh',
  [
    body('refreshToken').isString().notEmpty(),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const result = await auth.refreshToken(
        req.body.refreshToken,
        req.ip
      )
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

router.post(
  '/auth/logout',
  authenticate,
  async (req, res, next) => {
    try {
      await auth.logout(req.user.userId, req.user.sessionId)
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }
)

// Contract generation routes
router.post(
  '/contracts/generate',
  authenticate,
  [
    body('prompt').isString().notEmpty(),
    body('options').isObject(),
    body('options.security').isString().isIn(['high', 'medium', 'low']),
    body('options.optimization').isString().isIn(['high', 'medium', 'low']),
    body('options.testing').isBoolean(),
    validateRequest,
    rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10 // limit each IP to 10 requests per windowMs
    })
  ],
  async (req, res, next) => {
    try {
      const startTime = performance.now()
      const { prompt, options } = req.body

      const result = await ai.generateContract(prompt, options)
      
      metrics.gauge('contract_generation_duration', performance.now() - startTime)
      metrics.increment('contracts_generated_total')

      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

router.get(
  '/contracts/:contractId/analysis',
  authenticate,
  [
    param('contractId').isUUID(),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const analysis = await analyzer.analyzeContract(req.params.contractId)
      res.json(analysis)
    } catch (error) {
      next(error)
    }
  }
)

// Contract template routes
router.get(
  '/templates',
  authenticate,
  [
    query('category').optional().isString(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { category, page = 1, limit = 20 } = req.query
      const templates = await ai.listTemplates(category, page, limit)
      res.json(templates)
    } catch (error) {
      next(error)
    }
  }
)

router.get(
  '/templates/:templateId',
  authenticate,
  [
    param('templateId').isUUID(),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const template = await ai.getTemplate(req.params.templateId)
      if (!template) {
        res.status(404).json({ message: 'Template not found' })
        return
      }
      res.json(template)
    } catch (error) {
      next(error)
    }
  }
)

// Health check route
router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '0.0.0',
    services: {
      ai: await ai.healthCheck(),
      auth: await auth.healthCheck(),
      metrics: metrics.healthCheck()
    }
  }

  const unhealthyServices = Object.entries(health.services)
    .filter(([_, status]) => !status)
    .map(([service]) => service)

  if (unhealthyServices.length > 0) {
    logger.error('Unhealthy services detected', { services: unhealthyServices })
    res.status(503).json({
      ...health,
      status: 'unhealthy',
      unhealthyServices
    })
    return
  }

  res.json(health)
})

// Documentation route
router.get('/docs', (req, res) => {
  res.redirect(config.app.docsUrl)
})

// Version route
router.get('/version', (req, res) => {
  res.json({
    version: process.env.APP_VERSION || '0.0.0',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  })
})

export default router
