import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { MetricsService } from '../services/analytics/MetricsService';
import { PerformanceAnalyzer } from '../services/analytics/PerformanceAnalyzer';
import { UsageTracker } from '../services/analytics/UsageTracker';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class AnalyticsController {
    private metricsService: MetricsService;
    private performanceAnalyzer: PerformanceAnalyzer;
    private usageTracker: UsageTracker;

    constructor() {
        this.metricsService = new MetricsService();
        this.performanceAnalyzer = new PerformanceAnalyzer();
        this.usageTracker = new UsageTracker();
    }

    public getMetrics = async (req: Request, res: Response): Promise<void> => {
        const { startDate, endDate } = req.query;
        const requestId = req.id;

        try {
            const metrics = await this.metricsService.getMetrics({
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                includeHistorical: true,
                calculateTrends: true
            });

            logger.info('Metrics retrieved', {
                requestId,
                timeframe: `${startDate} - ${endDate}`
            });

            res.json({
                success: true,
                data: {
                    overview: {
                        totalContracts: metrics.overview.totalContracts,
                        activeContracts: metrics.overview.activeContracts,
                        totalDeployments: metrics.overview.totalDeployments,
                        successRate: metrics.overview.successRate
                    },
                    performance: {
                        averageResponseTime: metrics.performance.averageResponseTime,
                        p95ResponseTime: metrics.performance.p95ResponseTime,
                        uptime: metrics.performance.uptime,
                        errorRate: metrics.performance.errorRate
                    },
                    usage: {
                        totalRequests: metrics.usage.totalRequests,
                        uniqueUsers: metrics.usage.uniqueUsers,
                        peakConcurrency: metrics.usage.peakConcurrency,
                        resourceUtilization: metrics.usage.resourceUtilization
                    },
                    trends: metrics.trends,
                    timeframe: {
                        start: metrics.timeframe.start,
                        end: metrics.timeframe.end
                    }
                }
            });
        } catch (error) {
            logger.error('Metrics retrieval failed', {
                requestId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public getContractPerformance = async (req: Request, res: Response): Promise<void> => {
        const { pubkey } = req.params;
        const { period } = req.query;
        const requestId = req.id;

        try {
            const performance = await this.performanceAnalyzer.analyzeContract(
                new PublicKey(pubkey),
                {
                    period: period as string || 'day',
                    includeTransactions: true,
                    calculateOptimizations: true
                }
            );

            if (!performance) {
                throw new NotFoundError('Contract performance data');
            }

            logger.info('Contract performance retrieved', {
                requestId,
                pubkey,
                period
            });

            res.json({
                success: true,
                data: {
                    metrics: {
                        computeUnits: performance.metrics.computeUnits,
                        transactionCount: performance.metrics.transactionCount,
                        averageLatency: performance.metrics.averageLatency,
                        successRate: performance.metrics.successRate,
                        costEfficiency: performance.metrics.costEfficiency
                    },
                    optimization: {
                        potentialSavings: performance.optimization.potentialSavings,
                        recommendations: performance.optimization.recommendations,
                        bottlenecks: performance.optimization.bottlenecks
                    },
                    transactions: {
                        recent: performance.transactions.recent,
                        trends: performance.transactions.trends
                    },
                    resources: {
                        memoryUsage: performance.resources.memoryUsage,
                        storageUsage: performance.resources.storageUsage,
                        cpuUtilization: performance.resources.cpuUtilization
                    }
                }
            });
        } catch (error) {
            logger.error('Contract performance retrieval failed', {
                requestId,
                pubkey,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public getUsageStats = async (req: Request, res: Response): Promise<void> => {
        const { startDate, endDate, groupBy } = req.query;
        const requestId = req.id;

        try {
            const usageStats = await this.usageTracker.getStats({
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                groupBy: groupBy as string || 'day',
                includeBreakdown: true
            });

            logger.info('Usage stats retrieved', {
                requestId,
                timeframe: `${startDate} - ${endDate}`,
                groupBy
            });

            res.json({
                success: true,
                data: {
                    summary: {
                        totalRequests: usageStats.summary.totalRequests,
                        uniqueUsers: usageStats.summary.uniqueUsers,
                        averageRequestsPerUser: usageStats.summary.averageRequestsPerUser,
                        peakConcurrentUsers: usageStats.summary.peakConcurrentUsers
                    },
                    breakdown: {
                        byEndpoint: usageStats.breakdown.byEndpoint,
                        byUserType: usageStats.breakdown.byUserType,
                        byResponseStatus: usageStats.breakdown.byResponseStatus,
                        byGeography: usageStats.breakdown.byGeography
                    },
                    trends: {
                        daily: usageStats.trends.daily,
                        weekly: usageStats.trends.weekly,
                        monthly: usageStats.trends.monthly
                    },
                    quotas: {
                        current: usageStats.quotas.current,
                        limits: usageStats.quotas.limits,
                        resets: usageStats.quotas.resets
                    }
                }
            });
        } catch (error) {
            logger.error('Usage stats retrieval failed', {
                requestId,
                error: error.message,
                stack: error.stack,
                params: {
                    startDate,
                    endDate,
                    groupBy
                }
            });
            throw error;
        }
    };

    public getResourceMetrics = async (req: Request, res: Response): Promise<void> => {
        const { resource, startTime, endTime, resolution } = req.query;
        const requestId = req.id;

        try {
            const metrics = await this.metricsService.getResourceMetrics({
                resource: resource as string,
                startTime: startTime ? parseInt(startTime as string) : undefined,
                endTime: endTime ? parseInt(endTime as string) : undefined,
                resolution: resolution as string || '1h'
            });

            const aggregatedMetrics = await this.metricsService.aggregateMetrics(metrics, {
                functions: ['avg', 'max', 'min', 'p95', 'p99'],
                groupBy: ['resource', 'instance']
            });

            logger.info('Resource metrics retrieved', {
                requestId,
                resource,
                timeRange: `${startTime} - ${endTime}`,
                dataPoints: metrics.length
            });

            res.json({
                success: true,
                data: {
                    metrics: metrics.map(metric => ({
                        timestamp: metric.timestamp,
                        value: metric.value,
                        unit: metric.unit,
                        tags: metric.tags
                    })),
                    aggregations: {
                        average: aggregatedMetrics.average,
                        maximum: aggregatedMetrics.maximum,
                        minimum: aggregatedMetrics.minimum,
                        percentile95: aggregatedMetrics.percentile95,
                        percentile99: aggregatedMetrics.percentile99
                    },
                    metadata: {
                        resolution: resolution || '1h',
                        startTime: metrics[0]?.timestamp,
                        endTime: metrics[metrics.length - 1]?.timestamp,
                        resourceType: resource
                    }
                }
            });
        } catch (error) {
            logger.error('Resource metrics retrieval failed', {
                requestId,
                resource,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public getSystemHealth = async (req: Request, res: Response): Promise<void> => {
        const requestId = req.id;

        try {
            const healthStatus = await this.metricsService.checkSystemHealth({
                checkConnections: true,
                checkDependencies: true,
                checkResourceUsage: true,
                timeout: 5000
            });

            const alerts = await this.metricsService.getActiveAlerts();
            const capacity = await this.metricsService.getSystemCapacity();

            logger.info('System health check completed', {
                requestId,
                status: healthStatus.status,
                alerts: alerts.length
            });

            res.json({
                success: true,
                data: {
                    status: healthStatus.status,
                    components: {
                        database: healthStatus.components.database,
                        cache: healthStatus.components.cache,
                        blockchain: healthStatus.components.blockchain,
                        ai: healthStatus.components.ai
                    },
                    metrics: {
                        uptime: healthStatus.metrics.uptime,
                        responseTime: healthStatus.metrics.responseTime,
                        errorRate: healthStatus.metrics.errorRate,
                        successRate: healthStatus.metrics.successRate
                    },
                    resources: {
                        cpu: {
                            usage: healthStatus.resources.cpu.usage,
                            available: healthStatus.resources.cpu.available,
                            threshold: healthStatus.resources.cpu.threshold
                        },
                        memory: {
                            usage: healthStatus.resources.memory.usage,
                            available: healthStatus.resources.memory.available,
                            threshold: healthStatus.resources.memory.threshold
                        },
                        storage: {
                            usage: healthStatus.resources.storage.usage,
                            available: healthStatus.resources.storage.available,
                            threshold: healthStatus.resources.storage.threshold
                        }
                    },
                    alerts: alerts.map(alert => ({
                        id: alert.id,
                        severity: alert.severity,
                        message: alert.message,
                        component: alert.component,
                        timestamp: alert.timestamp,
                        status: alert.status
                    })),
                    capacity: {
                        current: capacity.current,
                        maximum: capacity.maximum,
                        recommended: capacity.recommended,
                        trending: capacity.trending
                    },
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('System health check failed', {
                requestId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public getAuditLogs = async (req: Request, res: Response): Promise<void> => {
        const { startDate, endDate, level, component, limit } = req.query;
        const requestId = req.id;

        try {
            const auditLogs = await this.metricsService.getAuditLogs({
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                level: level as string,
                component: component as string,
                limit: limit ? parseInt(limit as string) : 100
            });

            const summary = await this.metricsService.summarizeAuditLogs(auditLogs);

            logger.info('Audit logs retrieved', {
                requestId,
                logsCount: auditLogs.length,
                timeRange: `${startDate} - ${endDate}`
            });

            res.json({
                success: true,
                data: {
                    logs: auditLogs.map(log => ({
                        id: log.id,
                        timestamp: log.timestamp,
                        level: log.level,
                        component: log.component,
                        action: log.action,
                        user: log.user,
                        details: log.details,
                        metadata: log.metadata
                    })),
                    summary: {
                        totalEvents: summary.totalEvents,
                        byLevel: summary.byLevel,
                        byComponent: summary.byComponent,
                        byAction: summary.byAction,
                        byUser: summary.byUser
                    },
                    pagination: {
                        total: summary.totalEvents,
                        returned: auditLogs.length,
                        hasMore: auditLogs.length === limit
                    }
                }
            });
        } catch (error) {
            logger.error('Audit logs retrieval failed', {
                requestId,
                error: error.message,
                stack: error.stack,
                params: {
                    startDate,
                    endDate,
                    level,
                    component
                }
            });
            throw error;
        }
    };
}
