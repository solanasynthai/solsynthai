import { RedisClientType } from 'redis';
import { PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { SystemMetrics, MetricAggregation, MetricTimeframe } from '../../types/analytics';
import { redisClient } from '../../utils/redis';
import config from '../../config';

interface MetricQuery {
  startTime?: number;
  endTime?: number;
  resolution?: string;
  filters?: Record<string, any>;
  groupBy?: string[];
}

interface MetricDataPoint {
  timestamp: number;
  value: number;
  tags: Record<string, string>;
}

export class MetricsService extends EventEmitter {
  private static instance: MetricsService;
  private readonly redis: RedisClientType;
  private readonly metricPrefix = 'metrics:';
  private readonly aggregationPrefix = 'aggregations:';
  private readonly retentionPeriods = {
    raw: 7 * 24 * 60 * 60, // 7 days
    '1m': 30 * 24 * 60 * 60, // 30 days
    '1h': 90 * 24 * 60 * 60, // 90 days
    '1d': 365 * 24 * 60 * 60, // 1 year
  };

  private constructor() {
    super();
    this.redis = redisClient;
    this.setupCleanupTasks();
  }

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public async recordMetric(
    name: string,
    value: number,
    tags: Record<string, string> = {},
    timestamp: number = Date.now()
  ): Promise<void> {
    try {
      const metricKey = this.getMetricKey(name, timestamp);
      const metricData: MetricDataPoint = {
        timestamp,
        value,
        tags,
      };

      await this.redis.zAdd(metricKey, {
        score: timestamp,
        value: JSON.stringify(metricData),
      });

      // Record metric metadata
      await this.updateMetricMetadata(name, tags);

      this.emit('metric:recorded', { name, value, tags, timestamp });
    } catch (error) {
      logger.error('Error recording metric', {
        name,
        value,
        tags,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  public async getMetrics(name: string, query: MetricQuery = {}): Promise<MetricDataPoint[]> {
    try {
      const { startTime = 0, endTime = Date.now() } = query;
      const metricKey = this.getMetricKey(name);

      const rawData = await this.redis.zRangeByScore(
        metricKey,
        startTime.toString(),
        endTime.toString()
      );

      return rawData.map((data) => JSON.parse(data) as MetricDataPoint);
    } catch (error) {
      logger.error('Error fetching metrics', {
        name,
        query,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  public async aggregateMetrics(
    name: string,
    timeframe: MetricTimeframe,
    aggregation: MetricAggregation
  ): Promise<Record<string, number>> {
    try {
      const metrics = await this.getMetrics(name);
      const result: Record<string, number> = {};

      // Group metrics by timeframe
      const groupedMetrics = this.groupMetricsByTimeframe(metrics, timeframe);

      // Calculate aggregations for each group
      for (const [timestamp, values] of Object.entries(groupedMetrics)) {
        result[timestamp] = this.calculateAggregation(values, aggregation);
      }

      return result;
    } catch (error) {
      logger.error('Error aggregating metrics', {
        name,
        timeframe,
        aggregation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  public async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 24 * 60 * 60 * 1000; // Last 24 hours

      const [
        cpuUsage,
        memoryUsage,
        requests,
        errors,
        latencies,
      ] = await Promise.all([
        this.getMetrics('system.cpu', { startTime, endTime }),
        this.getMetrics('system.memory', { startTime, endTime }),
        this.getMetrics('http.requests', { startTime, endTime }),
        this.getMetrics('http.errors', { startTime, endTime }),
        this.getMetrics('http.latency', { startTime, endTime }),
      ]);

      const totalRequests = requests.reduce((sum, metric) => sum + metric.value, 0);
      const totalErrors = errors.reduce((sum, metric) => sum + metric.value, 0);
      const avgLatency = latencies.reduce((sum, metric) => sum + metric.value, 0) / latencies.length;

      return {
        cpu: {
          current: cpuUsage[cpuUsage.length - 1]?.value || 0,
          average: this.calculateAverage(cpuUsage.map(m => m.value)),
        },
        memory: {
          current: memoryUsage[memoryUsage.length - 1]?.value || 0,
          average: this.calculateAverage(memoryUsage.map(m => m.value)),
        },
        requests: {
          total: totalRequests,
          errorRate: totalErrors / totalRequests,
          averageLatency: avgLatency,
        },
        uptime: process.uptime(),
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('Error getting system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async updateMetricMetadata(name: string, tags: Record<string, string>): Promise<void> {
    const metadataKey = `${this.metricPrefix}metadata:${name}`;
    const metadata = {
      lastUpdated: Date.now(),
      tags: Object.keys(tags),
    };

    await this.redis.set(metadataKey, JSON.stringify(metadata));
  }

  private getMetricKey(name: string, timestamp?: number): string {
    if (!timestamp) {
      return `${this.metricPrefix}${name}`;
    }

    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');

    return `${this.metricPrefix}${name}:${year}:${month}:${day}`;
  }

  private groupMetricsByTimeframe(
    metrics: MetricDataPoint[],
    timeframe: MetricTimeframe
  ): Record<string, number[]> {
    const grouped: Record<string, number[]> = {};
    const interval = this.getTimeframeInterval(timeframe);

    for (const metric of metrics) {
      const timestamp = Math.floor(metric.timestamp / interval) * interval;
      if (!grouped[timestamp]) {
        grouped[timestamp] = [];
      }
      grouped[timestamp].push(metric.value);
    }

    return grouped;
  }

  private calculateAggregation(values: number[], aggregation: MetricAggregation): number {
    switch (aggregation) {
      case 'avg':
        return this.calculateAverage(values);
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      default:
        throw new Error(`Unsupported aggregation: ${aggregation}`);
    }
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private getTimeframeInterval(timeframe: MetricTimeframe): number {
    switch (timeframe) {
      case '1m':
        return 60 * 1000;
      case '1h':
        return 60 * 60 * 1000;
      case '1d':
        return 24 * 60 * 60 * 1000;
      default:
        throw new Error(`Unsupported timeframe: ${timeframe}`);
    }
  }

  private setupCleanupTasks(): void {
    // Run cleanup every day at midnight
    setInterval(() => {
      this.cleanupOldMetrics().catch((error) => {
        logger.error('Error cleaning up old metrics', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }, 24 * 60 * 60 * 1000);
  }

  private async cleanupOldMetrics(): Promise<void> {
    const now = Date.now();

    for (const [resolution, retention] of Object.entries(this.retentionPeriods)) {
      const cutoff = now - retention * 1000;
      const pattern = `${this.metricPrefix}*:${resolution}`;

      const keys = await this.redis.keys(pattern);
      
      for (const key of keys) {
        await this.redis.zRemRangeByScore(key, '-inf', cutoff.toString());
      }
    }

    this.emit('metrics:cleanup', { timestamp: now });
  }

  public async destroy(): Promise<void> {
    this.removeAllListeners();
  }
}
