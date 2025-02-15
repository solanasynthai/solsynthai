import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { contractSchema, deploymentSchema, analyticsSchema } from '../schemas';
import { ContractController } from '../controllers/ContractController';
import { DeploymentController } from '../controllers/DeploymentController';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { rateLimit } from '../middleware/rateLimit';
import { cacheMiddleware } from '../middleware/cache';
import { MetricsService } from '../services/monitoring/MetricsService';

// Initialize controllers
const contractController = new ContractController();
const deploymentController = new DeploymentController();
const analyticsController = new AnalyticsController();

// Create router instance
const router = Router();

// Contract Routes
router.get(
  '/contracts',
  authMiddleware.optional,
  cacheMiddleware('contracts', 300),
  contractController.listContracts
);

router.get(
  '/contracts/:id',
  authMiddleware.optional,
  cacheMiddleware('contract', 60),
  contractController.getContract
);

router.post(
  '/contracts',
  authMiddleware.required,
  validate(contractSchema.create),
  rateLimit({
    windowMs: 60000,
    max: 10,
    message: 'Too many contract creations from this IP'
  }),
  async (req, res, next) => {
    const startTime = Date.now();
    try {
      await contractController.createContract(req, res);
      MetricsService.timing('contract.create', Date.now() - startTime);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/contracts/:id',
  authMiddleware.required,
  validate(contractSchema.update),
  contractController.updateContract
);

router.delete(
  '/contracts/:id',
  authMiddleware.required,
  contractController.deleteContract
);

// Deployment Routes
router.post(
  '/deployments',
  authMiddleware.required,
  validate(deploymentSchema.create),
  rateLimit({
    windowMs: 300000,
    max: 5,
    message: 'Too many deployment attempts from this IP'
  }),
  deploymentController.createDeployment
);

router.get(
  '/deployments/:id',
  authMiddleware.required,
  deploymentController.getDeployment
);

router.get(
  '/deployments/:id/status',
  authMiddleware.required,
  cacheMiddleware('deployment-status', 10),
  deploymentController.getDeploymentStatus
);

router.post(
  '/deployments/:id/verify',
  authMiddleware.required,
  validate(deploymentSchema.verify),
  deploymentController.verifyDeployment
);

// Analytics Routes
router.get(
  '/analytics/contracts/:id/metrics',
  authMiddleware.required,
  validate(analyticsSchema.metrics),
  cacheMiddleware('contract-metrics', 300),
  analyticsController.getContractMetrics
);

router.get(
  '/analytics/contracts/:id/performance',
  authMiddleware.required,
  validate(analyticsSchema.performance),
  cacheMiddleware('contract-performance', 300),
  analyticsController.getContractPerformance
);

router.get(
  '/analytics/contracts/:id/security',
  authMiddleware.required,
  validate(analyticsSchema.security),
  cacheMiddleware('contract-security', 600),
  analyticsController.getSecurityAnalysis
);

// Compiler Routes
router.post(
  '/compile',
  authMiddleware.required,
  validate(contractSchema.compile),
  rateLimit({
    windowMs: 60000,
    max: 10,
    message: 'Too many compilation requests from this IP'
  }),
  async (req, res, next) => {
    const startTime = Date.now();
    try {
      await contractController.compileContract(req, res);
      MetricsService.timing('contract.compile', Date.now() - startTime);
    } catch (error) {
      next(error);
    }
  }
);

// Optimization Routes
router.post(
  '/optimize',
  authMiddleware.required,
  validate(contractSchema.optimize),
  rateLimit({
    windowMs: 60000,
    max: 5,
    message: 'Too many optimization requests from this IP'
  }),
  contractController.optimizeContract
);

// Audit Routes
router.post(
  '/contracts/:id/audit',
  authMiddleware.required,
  validate(contractSchema.audit),
  rateLimit({
    windowMs: 300000,
    max: 3,
    message: 'Too many audit requests from this IP'
  }),
  contractController.auditContract
);

router.get(
  '/contracts/:id/audit/results',
  authMiddleware.required,
  cacheMiddleware('audit-results', 600),
  contractController.getAuditResults
);

// Version Control Routes
router.get(
  '/contracts/:id/versions',
  authMiddleware.required,
  cacheMiddleware('contract-versions', 300),
  contractController.getContractVersions
);

router.post(
  '/contracts/:id/versions',
  authMiddleware.required,
  validate(contractSchema.createVersion),
  contractController.createContractVersion
);

// Health Check Route
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version
  });
});

// Error handling for unmatched routes
router.use((req, res) => {
  res.status(404).json({
    status: 'error',
    code: 'NOT_FOUND',
    message: 'Requested resource not found'
  });
});

export default router;
