import { Router } from 'express';
import { z } from 'zod';
import { AuthMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { ContractAnalyzer } from '../../services/analysis/ContractAnalyzer';
import { SecurityScanner } from '../../services/security/SecurityScanner';
import { MetricsService } from '../../services/monitoring/MetricsService';
import { ContractCache } from '../../services/cache/ContractCache';
import { ApiError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { 
  AnalysisResult, 
  SecurityReport, 
  VulnerabilityLevel 
} from '../../types/analysis';

const router = Router();
const analyzer = ContractAnalyzer.getInstance();
const securityScanner = SecurityScanner.getInstance();
const metrics = MetricsService.getInstance();
const cache = ContractCache.getInstance();

const AnalyzeContractSchema = z.object({
  contractId: z.string().uuid(),
  options: z.object({
    securityLevel: z.enum(['basic', 'standard', 'comprehensive']).default('standard'),
    includeGasAnalysis: z.boolean().default(true),
    includeDataFlow: z.boolean().default(true),
    skipCache: z.boolean().default(false)
  }).default({})
});

router.post('/contract',
  AuthMiddleware.authenticate,
  validate(AnalyzeContractSchema),
  async (req, res, next) => {
    const startTime = Date.now();
    const { contractId, options } = req.body;
    const userId = req.user.id;

    try {
      // Check cache if not explicitly skipped
      if (!options.skipCache) {
        const cachedAnalysis = await cache.getAnalysis(contractId);
        if (cachedAnalysis) {
          metrics.increment('contract_analysis.cache_hit');
          return res.json({
            success: true,
            data: cachedAnalysis,
            meta: { cached: true }
          });
        }
      }

      // Get contract
      const contract = await cache.getContract(contractId);
      if (!contract) {
        throw new ApiError('CONTRACT_NOT_FOUND', 'Contract not found');
      }

      // Run security scan
      const securityReport = await securityScanner.scan(contract.code, {
        level: options.securityLevel,
        includeRemediation: true,
        checkPatterns: [
          'reentrancy',
          'arithmetic',
          'access-control',
          'data-validation',
          'upgrade-safety'
        ]
      });

      // Run analysis
      const analysis = await analyzer.analyze(contract.code, {
        includeGasAnalysis: options.includeGasAnalysis,
        includeDataFlow: options.includeDataFlow
      });

      // Combine results
      const result: AnalysisResult = {
        security: securityReport,
        performance: analysis.performance,
        complexity: analysis.complexity,
        dataFlow: options.includeDataFlow ? analysis.dataFlow : undefined,
        gasEstimates: options.includeGasAnalysis ? analysis.gasEstimates : undefined,
        timestamp: new Date().toISOString()
      };

      // Cache results
      await cache.setAnalysis(contractId, result, 3600); // Cache for 1 hour

      // Record metrics
      metrics.timing('contract_analysis.duration', Date.now() - startTime);
      recordVulnerabilityMetrics(securityReport);

      res.json({
        success: true,
        data: result,
        meta: {
          analysisTime: Date.now() - startTime,
          securityLevel: options.securityLevel
        }
      });

    } catch (error) {
      metrics.increment('contract_analysis.error', {
        errorType: error instanceof ApiError ? error.code : 'UNKNOWN'
      });

      logger.error('Contract analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractId,
        userId
      });

      next(error);
    }
  }
);

router.get('/vulnerabilities/:contractId',
  AuthMiddleware.authenticate,
  async (req, res, next) => {
    try {
      const contractId = req.params.contractId;
      const analysis = await cache.getAnalysis(contractId);

      if (!analysis) {
        throw new ApiError('ANALYSIS_NOT_FOUND', 'Contract analysis not found');
      }

      const vulnerabilities = analysis.security.vulnerabilities;
      
      // Group vulnerabilities by severity
      const grouped = vulnerabilities.reduce((acc, vuln) => {
        acc[vuln.severity] = acc[vuln.severity] || [];
        acc[vuln.severity].push(vuln);
        return acc;
      }, {} as Record<VulnerabilityLevel, typeof vulnerabilities>);

      res.json({
        success: true,
        data: {
          total: vulnerabilities.length,
          grouped,
          summary: generateVulnerabilitySummary(vulnerabilities)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

router.get('/gas-estimates/:contractId',
  AuthMiddleware.authenticate,
  async (req, res, next) => {
    try {
      const contractId = req.params.contractId;
      const analysis = await cache.getAnalysis(contractId);

      if (!analysis || !analysis.gasEstimates) {
        throw new ApiError('ANALYSIS_NOT_FOUND', 'Gas analysis not found');
      }

      res.json({
        success: true,
        data: analysis.gasEstimates
      });

    } catch (error) {
      next(error);
    }
  }
);

function recordVulnerabilityMetrics(report: SecurityReport): void {
  const severityCounts = report.vulnerabilities.reduce((acc, vuln) => {
    acc[vuln.severity] = (acc[vuln.severity] || 0) + 1;
    return acc;
  }, {} as Record<VulnerabilityLevel, number>);

  Object.entries(severityCounts).forEach(([severity, count]) => {
    metrics.gauge(`vulnerabilities.${severity}`, count);
  });

  metrics.gauge('vulnerabilities.total', report.vulnerabilities.length);
  metrics.gauge('security_score', report.score);
}

function generateVulnerabilitySummary(vulnerabilities: SecurityReport['vulnerabilities']) {
  const totalIssues = vulnerabilities.length;
  const criticalIssues = vulnerabilities.filter(v => v.severity === 'critical').length;
  const highIssues = vulnerabilities.filter(v => v.severity === 'high').length;
  
  const riskLevel = criticalIssues > 0 ? 'Critical' :
    highIssues > 0 ? 'High' :
    totalIssues > 0 ? 'Moderate' : 'Low';

  return {
    riskLevel,
    totalIssues,
    criticalIssues,
    highIssues,
    recommendation: criticalIssues > 0 ? 
      'Critical vulnerabilities must be fixed before deployment' :
      highIssues > 0 ?
      'High severity issues should be addressed before mainnet deployment' :
      'Contract is relatively secure but review recommended issues'
  };
}

export default router;
