import { Connection, PublicKey, ConfirmedTransactionMeta, ParsedTransactionWithMeta } from '@solana/web3.js';
import { AnchorProvider } from '@project-serum/anchor';
import { Redis } from 'ioredis';
import { Logger } from '../../utils/logger';
import { MetricsRepository } from '../../repositories/MetricsRepository';
import { PerformanceMetric, TransactionMetrics, ContractMetrics } from '../../types/analytics';
import { CONFIG } from '../../config';

export class PerformanceAnalyzer {
    private connection: Connection;
    private redis: Redis;
    private metricsRepository: MetricsRepository;
    private logger: Logger;

    constructor(
        connection: Connection,
        redis: Redis,
        metricsRepository: MetricsRepository,
        logger: Logger
    ) {
        this.connection = connection;
        this.redis = redis;
        this.metricsRepository = metricsRepository;
        this.logger = logger;
    }

    /**
     * Analyzes transaction performance metrics
     * @param signature Transaction signature to analyze
     * @returns Transaction performance metrics
     */
    public async analyzeTransactionPerformance(signature: string): Promise<TransactionMetrics> {
        try {
            const transaction = await this.connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
            });

            if (!transaction) {
                throw new Error(`Transaction ${signature} not found`);
            }

            const metrics: TransactionMetrics = {
                signature,
                timestamp: transaction.blockTime ? new Date(transaction.blockTime * 1000) : new Date(),
                computeUnits: this.extractComputeUnits(transaction.meta),
                executionTime: this.calculateExecutionTime(transaction),
                fee: transaction.meta?.fee || 0,
                status: transaction.meta?.err ? 'failed' : 'success',
                slot: transaction.slot,
            };

            // Cache metrics for quick access
            await this.cacheMetrics(signature, metrics);
            
            // Store metrics in database
            await this.metricsRepository.saveTransactionMetrics(metrics);

            return metrics;
        } catch (error) {
            this.logger.error('Error analyzing transaction performance', {
                signature,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }

    /**
     * Analyzes smart contract performance metrics
     * @param programId Program ID to analyze
     * @param timeframe Timeframe in seconds to analyze
     * @returns Contract performance metrics
     */
    public async analyzeContractPerformance(
        programId: string,
        timeframe: number = 3600
    ): Promise<ContractMetrics> {
        try {
            const publicKey = new PublicKey(programId);
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - timeframe * 1000);

            const signatures = await this.connection.getSignaturesForAddress(
                publicKey,
                { before: endTime.toISOString(), until: startTime.toISOString() }
            );

            const metrics: ContractMetrics = {
                programId,
                timeframe,
                totalTransactions: signatures.length,
                successRate: 0,
                averageExecutionTime: 0,
                averageComputeUnits: 0,
                totalFees: 0,
                timestamp: new Date(),
            };

            let successfulTxs = 0;
            let totalExecutionTime = 0;
            let totalComputeUnits = 0;

            for (const { signature } of signatures) {
                if (!signature) continue;
                
                const txMetrics = await this.getTransactionMetrics(signature);
                if (txMetrics) {
                    if (txMetrics.status === 'success') successfulTxs++;
                    totalExecutionTime += txMetrics.executionTime;
                    totalComputeUnits += txMetrics.computeUnits;
                    metrics.totalFees += txMetrics.fee;
                }
            }

            metrics.successRate = (successfulTxs / signatures.length) * 100;
            metrics.averageExecutionTime = totalExecutionTime / signatures.length;
            metrics.averageComputeUnits = totalComputeUnits / signatures.length;

            // Store contract metrics
            await this.metricsRepository.saveContractMetrics(metrics);

            return metrics;
        } catch (error) {
            this.logger.error('Error analyzing contract performance', {
                programId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }

    /**
     * Gets performance alerts based on predefined thresholds
     * @param programId Program ID to check
     * @returns Array of performance alerts
     */
    public async getPerformanceAlerts(programId: string): Promise<PerformanceMetric[]> {
        try {
            const metrics = await this.metricsRepository.getLatestContractMetrics(programId);
            const alerts: PerformanceMetric[] = [];

            if (!metrics) return alerts;

            // Check success rate threshold
            if (metrics.successRate < CONFIG.PERFORMANCE.THRESHOLDS.SUCCESS_RATE) {
                alerts.push({
                    type: 'SUCCESS_RATE',
                    value: metrics.successRate,
                    threshold: CONFIG.PERFORMANCE.THRESHOLDS.SUCCESS_RATE,
                    timestamp: new Date(),
                    severity: 'HIGH',
                });
            }

            // Check average execution time threshold
            if (metrics.averageExecutionTime > CONFIG.PERFORMANCE.THRESHOLDS.AVG_EXECUTION_TIME) {
                alerts.push({
                    type: 'EXECUTION_TIME',
                    value: metrics.averageExecutionTime,
                    threshold: CONFIG.PERFORMANCE.THRESHOLDS.AVG_EXECUTION_TIME,
                    timestamp: new Date(),
                    severity: 'MEDIUM',
                });
            }

            // Check compute units utilization
            if (metrics.averageComputeUnits > CONFIG.PERFORMANCE.THRESHOLDS.COMPUTE_UNITS) {
                alerts.push({
                    type: 'COMPUTE_UNITS',
                    value: metrics.averageComputeUnits,
                    threshold: CONFIG.PERFORMANCE.THRESHOLDS.COMPUTE_UNITS,
                    timestamp: new Date(),
                    severity: 'MEDIUM',
                });
            }

            return alerts;
        } catch (error) {
            this.logger.error('Error getting performance alerts', {
                programId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }

    private async cacheMetrics(signature: string, metrics: TransactionMetrics): Promise<void> {
        const cacheKey = `tx:metrics:${signature}`;
        await this.redis.setex(
            cacheKey,
            CONFIG.CACHE.TRANSACTION_METRICS_TTL,
            JSON.stringify(metrics)
        );
    }

    private async getTransactionMetrics(signature: string): Promise<TransactionMetrics | null> {
        const cacheKey = `tx:metrics:${signature}`;
        const cachedMetrics = await this.redis.get(cacheKey);

        if (cachedMetrics) {
            return JSON.parse(cachedMetrics);
        }

        return null;
    }

    private extractComputeUnits(meta: ConfirmedTransactionMeta | null): number {
        if (!meta || !meta.computeUnitsConsumed) return 0;
        return meta.computeUnitsConsumed;
    }

    private calculateExecutionTime(transaction: ParsedTransactionWithMeta): number {
        if (!transaction.meta || !transaction.blockTime) return 0;
        
        // Calculate execution time based on block time and confirmation time
        const confirmationTime = transaction.meta.confirmationStatus === 'finalized' 
            ? transaction.blockTime * 1000 
            : Date.now();
            
        return confirmationTime - (transaction.blockTime * 1000);
    }
}
