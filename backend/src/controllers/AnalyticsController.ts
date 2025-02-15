import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Connection, PublicKey } from '@solana/web3.js';
import { ErrorWithCode } from '../utils/errors';
import { MetricsService } from '../services/monitoring/MetricsService';
import { logger } from '../utils/logger';
import { config } from '../config';
import { Network, TimeRange } from '../types';

export class AnalyticsController {
  private db: Pool;
  private redis: Redis;
  private connections: Map<Network, Connection>;
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor() {
    this.db = new Pool(config.database);
    this.redis = new Redis(config.redis.url);
    this.connections = new Map(
      Object.entries(config.solana.networks).map(([network, url]) => [
        network as Network,
        new Connection(url, { commitment: 'confirmed' })
      ])
    );
  }

  public getContractAnalytics = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { contractId } = req.params;
      const { startDate, endDate, timeRange = TimeRange.DAY } = req.query;

      // Validate date range
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new ErrorWithCode('Invalid date range', 'INVALID_DATE_RANGE');
      }

      // Check contract access
      const { rows: [contract] } = await this.db.query(`
        SELECT * FROM contracts WHERE id = $1
      `, [contractId]);

      if (!contract) {
        throw new ErrorWithCode('Contract not found', 'CONTRACT_NOT_FOUND');
      }

      if (contract.author_id !== req.user!.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      // Try to get from cache
      const cacheKey = `analytics:contract:${contractId}:${startDate}:${endDate}:${timeRange}`;
      const cachedData = await this.redis.get(cacheKey);
      
      if (cachedData) {
        res.json(JSON.parse(cachedData));
        return;
      }

      // Get analytics data
      const data = await this.aggregateContractMetrics(
        contractId,
        start,
        end,
        timeRange as TimeRange
      );

      // Cache the results
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(data));

      res.json(data);

      MetricsService.increment('analytics.contract.get', {
        timeRange
      });
    } catch (error) {
      next(error);
    }
  };

  public getSystemMetrics = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { timeframe = '24h' } = req.query;

      // Try to get from cache
      const cacheKey = `analytics:system:${timeframe}`;
      const cachedData = await this.redis.get(cacheKey);
      
      if (cachedData) {
        res.json(JSON.parse(cachedData));
        return;
      }

      // Calculate time range
      const end = new Date();
      const start = new Date();
      switch (timeframe) {
        case '1h':
          start.setHours(end.getHours() - 1);
          break;
        case '24h':
          start.setDate(end.getDate() - 1);
          break;
        case '7d':
          start.setDate(end.getDate() - 7);
          break;
        case '30d':
          start.setDate(end.getDate() - 30);
          break;
        default:
          throw new ErrorWithCode('Invalid timeframe', 'INVALID_TIMEFRAME');
      }

      const metrics = await this.getSystemMetricsData(start, end);

      // Cache the results
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(metrics));

      res.json(metrics);

      MetricsService.increment('analytics.system.get', {
        timeframe
      });
    } catch (error) {
      next(error);
    }
  };

  private async aggregateContractMetrics(
    contractId: string,
    startDate: Date,
    endDate: Date,
    timeRange: TimeRange
  ): Promise<any> {
    const { rows: deployments } = await this.db.query(`
      SELECT * FROM deployments
      WHERE contract_id = $1 AND created_at >= $2 AND created_at <= $3
    `, [contractId, startDate, endDate]);

    const metrics = {
      transactions: await this.aggregateTransactions(deployments, timeRange),
      computeUnits: await this.aggregateComputeUnits(deployments, timeRange),
      errors: await this.aggregateErrors(deployments, timeRange),
      uniqueUsers: await this.aggregateUniqueUsers(deployments, timeRange)
    };

    return {
      summary: this.calculateSummaryMetrics(metrics),
      timeseries: this.generateTimeseries(metrics, startDate, endDate, timeRange)
    };
  }

  private async aggregateTransactions(
    deployments: any[],
    timeRange: TimeRange
  ): Promise<any[]> {
    const transactions = [];
    
    for (const deployment of deployments) {
      const connection = this.connections.get(deployment.network as Network);
      if (!connection) continue;

      const programId = new PublicKey(deployment.program_id);
      const signatures = await connection.getConfirmedSignaturesForAddress2(
        programId,
        { limit: 1000 }
      );

      transactions.push(...signatures.map(sig => ({
        signature: sig.signature,
        timestamp: sig.blockTime ? new Date(sig.blockTime * 1000) : null,
        deployment: deployment.id
      })));
    }

    return transactions;
  }

  private async aggregateComputeUnits(
    deployments: any[],
    timeRange: TimeRange
  ): Promise<any[]> {
    const computeUnits = [];

    for (const deployment of deployments) {
      const { rows } = await this.db.query(`
        SELECT * FROM analytics
        WHERE deployment_id = $1
        ORDER BY period_start
      `, [deployment.id]);

      computeUnits.push(...rows.map(row => ({
        timestamp: row.period_start,
        value: row.compute_units_avg,
        deployment: deployment.id
      })));
    }

    return computeUnits;
  }

  private async aggregateErrors(
    deployments: any[],
    timeRange: TimeRange
  ): Promise<any[]> {
    const errors = [];

    for (const deployment of deployments) {
      const { rows } = await this.db.query(`
        SELECT * FROM analytics
        WHERE deployment_id = $1
        ORDER BY period_start
      `, [deployment.id]);

      errors.push(...rows.map(row => ({
        timestamp: row.period_start,
        value: row.error_rate,
        deployment: deployment.id
      })));
    }

    return errors;
  }

  private async aggregateUniqueUsers(
    deployments: any[],
    timeRange: TimeRange
  ): Promise<any[]> {
    const users = [];

    for (const deployment of deployments) {
      const { rows } = await this.db.query(`
        SELECT * FROM analytics
        WHERE deployment_id = $1
        ORDER BY period_start
      `, [deployment.id]);

      users.push(...rows.map(row => ({
        timestamp: row.period_start,
        value: row.unique_users,
        deployment: deployment.id
      })));
    }

    return users;
  }

  private calculateSummaryMetrics(metrics: any): any {
    return {
      totalTransactions: metrics.transactions.length,
      avgComputeUnits: this.calculateAverage(
        metrics.computeUnits.map((cu: any) => cu.value)
      ),
      avgErrorRate: this.calculateAverage(
        metrics.errors.map((err: any) => err.value)
      ),
      totalUniqueUsers: new Set(
        metrics.uniqueUsers.map((u: any) => u.value)
      ).size
    };
  }

  private generateTimeseries(
    metrics: any,
    startDate: Date,
    endDate: Date,
    timeRange: TimeRange
  ): any {
    const interval = this.getTimeInterval(timeRange);
    const series = [];
    
    for (
      let current = new Date(startDate);
      current <= endDate;
      current = new Date(current.getTime() + interval)
    ) {
      const next = new Date(current.getTime() + interval);
      
      series.push({
        timestamp: current.toISOString(),
        transactions: this.countInTimeRange(
          metrics.transactions,
          current,
          next
        ),
        computeUnits: this.averageInTimeRange(
          metrics.computeUnits,
          current,
          next
        ),
        errorRate: this.averageInTimeRange(
          metrics.errors,
          current,
          next
        ),
        uniqueUsers: this.countUniqueInTimeRange(
          metrics.uniqueUsers,
          current,
          next
        )
      });
    }

    return series;
  }

  private async getSystemMetricsData(
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const { rows } = await this.db.query(`
      SELECT
        COUNT(DISTINCT c.id) as total_contracts,
        COUNT(DISTINCT d.id) as total_deployments,
        COUNT(DISTINCT c.author_id) as total_users,
        AVG(a.compute_units_avg) as avg_compute_units,
        AVG(a.error_rate) as avg_error_rate
      FROM contracts c
      LEFT JOIN deployments d ON c.id = d.contract_id
      LEFT JOIN analytics a ON d.id = a.deployment_id
      WHERE c.created_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const networkStats = await Promise.all(
      Array.from(this.connections.entries()).map(async ([network, connection]) => {
        const stats = await connection.getRecentPerformanceSamples(60);
        return {
          network,
          tps: stats.reduce((acc, s) => acc + s.numTransactions, 0) / stats.length,
          slot: await connection.getSlot()
        };
      })
    );

    return {
      ...rows[0],
      networks: networkStats,
      timeframe: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    };
  }

  private getTimeInterval(timeRange: TimeRange): number {
    switch (timeRange) {
      case TimeRange.HOUR:
        return 60 * 1000; // 1 minute
      case TimeRange.DAY:
        return 60 * 60 * 1000; // 1 hour
      case TimeRange.WEEK:
        return 24 * 60 * 60 * 1000; // 1 day
      case TimeRange.MONTH:
        return 24 * 60 * 60 * 1000; // 1 day
      default:
        return 60 * 60 * 1000; // 1 hour
    }
  }

  private calculateAverage(values: number[]): number {
    return values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }

  private countInTimeRange(
    items: any[],
    start: Date,
    end: Date
  ): number {
    return items.filter(item =>
      item.timestamp >= start && item.timestamp < end
    ).length;
  }

  private averageInTimeRange(
    items: any[],
    start: Date,
    end: Date
  ): number {
    const values = items
      .filter(item => item.timestamp >= start && item.timestamp < end)
      .map(item => item.value);
    
    return this.calculateAverage(values);
  }

  private countUniqueInTimeRange(
    items: any[],
    start: Date,
    end: Date
  ): number {
    return new Set(
      items
        .filter(item => item.timestamp >= start && item.timestamp < end)
        .map(item => item.value)
    ).size;
  }
}

export default new AnalyticsController();
