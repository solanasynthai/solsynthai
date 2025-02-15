import { Pool, QueryResult } from 'pg';
import { Redis } from 'ioredis';
import { logger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import { config } from '../config';

export class MetricsRepository {
  private static instance: MetricsRepository;
  private pool: Pool;
  private redis: Redis;
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly METRICS_TABLE = 'app.metrics';
  private readonly ERROR_METRICS_TABLE = 'app.error_metrics';
  private readonly PERFORMANCE_METRICS_TABLE = 'app.performance_metrics';
  private readonly HEALTH_METRICS_TABLE = 'app.health_metrics';

  private constructor() {
    this.pool = new Pool(config.database);
    this.redis = new Redis(config.redis.url);

    this.pool.on('error', (err) => {
      logger.error('Unexpected database error', { error: err });
    });
  }

  public static getInstance(): MetricsRepository {
    if (!MetricsRepository.instance) {
      MetricsRepository.instance = new MetricsRepository();
    }
    return MetricsRepository.instance;
  }

  public async saveError(error: {
    type: string;
    message: string;
    stack?: string;
    context: Record<string, any>;
    timestamp: Date;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const query = `
        INSERT INTO ${this.ERROR_METRICS_TABLE} (
          error_type,
          message,
          stack_trace,
          context,
          created_at
        ) VALUES ($1, $2, $3, $4, $5)
      `;

      await client.query(query, [
        error.type,
        error.message,
        error.stack,
        JSON.stringify(error.context),
        error.timestamp
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new DatabaseError('Failed to save error metric', err);
    } finally {
      client.release();
    }
  }

  public async getErrorMetrics(
    startTime: number,
    endTime: number
  ): Promise<{
    total: number;
    byType: Record<string, number>;
    rate: number;
  }> {
    const cacheKey = `error_metrics:${startTime}:${endTime}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT 
        error_type,
        COUNT(*) as count
      FROM ${this.ERROR_METRICS_TABLE}
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY error_type
    `;

    try {
      const result = await this.pool.query(query, [
        new Date(startTime),
        new Date(endTime)
      ]);

      const byType: Record<string, number> = {};
      let total = 0;

      result.rows.forEach(row => {
        byType[row.error_type] = parseInt(row.count);
        total += parseInt(row.count);
      });

      const timespan = (endTime - startTime) / 1000; // Convert to seconds
      const rate = total / timespan;

      const metrics = { total, byType, rate };

      // Cache the results
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(metrics));

      return metrics;
    } catch (err) {
      throw new DatabaseError('Failed to get error metrics', err);
    }
  }

  public async getPerformanceMetrics(
    startTime: number,
    endTime: number
  ): Promise<{
    avgResponseTime: number;
    p95ResponseTime: number;
    requestRate: number;
  }> {
    const cacheKey = `performance_metrics:${startTime}:${endTime}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      WITH metrics AS (
        SELECT 
          response_time,
          COUNT(*) OVER () as total_requests,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time) OVER () as p95
        FROM ${this.PERFORMANCE_METRICS_TABLE}
        WHERE timestamp BETWEEN $1 AND $2
      )
      SELECT 
        AVG(response_time) as avg_response_time,
        MAX(p95) as p95_response_time,
        MAX(total_requests) as total_requests
      FROM metrics
    `;

    try {
      const result = await this.pool.query(query, [
        new Date(startTime),
        new Date(endTime)
      ]);

      const timespan = (endTime - startTime) / 1000;
      const metrics = {
        avgResponseTime: parseFloat(result.rows[0].avg_response_time) || 0,
        p95ResponseTime: parseFloat(result.rows[0].p95_response_time) || 0,
        requestRate: parseInt(result.rows[0].total_requests) / timespan
      };

      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(metrics));

      return metrics;
    } catch (err) {
      throw new DatabaseError('Failed to get performance metrics', err);
    }
  }

  public async getHealthMetrics(
    startTime: number,
    endTime: number
  ): Promise<{
    uptime: number;
    services: Record<string, { status: string; lastCheck: Date }>;
  }> {
    const query = `
      SELECT 
        service_name,
        status,
        MAX(checked_at) as last_check,
        COUNT(*) FILTER (WHERE status = 'up') * 100.0 / COUNT(*) as uptime_percentage
      FROM ${this.HEALTH_METRICS_TABLE}
      WHERE checked_at BETWEEN $1 AND $2
      GROUP BY service_name, status
    `;

    try {
      const result = await this.pool.query(query, [
        new Date(startTime),
        new Date(endTime)
      ]);

      const services: Record<string, { status: string; lastCheck: Date }> = {};
      let totalUptime = 0;
      let serviceCount = 0;

      result.rows.forEach(row => {
        services[row.service_name] = {
          status: row.status,
          lastCheck: row.last_check
        };
        totalUptime += parseFloat(row.uptime_percentage);
        serviceCount++;
      });

      return {
        uptime: serviceCount > 0 ? totalUptime / serviceCount : 100,
        services
      };
    } catch (err) {
      throw new DatabaseError('Failed to get health metrics', err);
    }
  }

  public async getPendingMetrics(): Promise<any[]> {
    const query = `
      SELECT *
      FROM ${this.METRICS_TABLE}
      WHERE processed = false
      ORDER BY created_at ASC
      LIMIT 1000
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (err) {
      throw new DatabaseError('Failed to get pending metrics', err);
    }
  }

  public async getErrorRate(
    errorType: string,
    timeWindow: number
  ): Promise<number> {
    const query = `
      WITH error_counts AS (
        SELECT 
          COUNT(*) FILTER (WHERE error_type = $1) as type_errors,
          COUNT(*) as total_errors
        FROM ${this.ERROR_METRICS_TABLE}
        WHERE created_at > NOW() - interval '1 second' * $2
      )
      SELECT 
        CASE 
          WHEN total_errors > 0 THEN type_errors::float / total_errors
          ELSE 0
        END as error_rate
      FROM error_counts
    `;

    try {
      const result = await this.pool.query(query, [errorType, timeWindow]);
      return parseFloat(result.rows[0].error_rate);
    } catch (err) {
      throw new DatabaseError('Failed to get error rate', err);
    }
  }

  public async cleanup(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Delete old metrics
      await client.query(`
        DELETE FROM ${this.METRICS_TABLE}
        WHERE created_at < NOW() - interval '30 days'
      `);

      // Delete old error metrics
      await client.query(`
        DELETE FROM ${this.ERROR_METRICS_TABLE}
        WHERE created_at < NOW() - interval '90 days'
      `);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new DatabaseError('Failed to cleanup metrics', err);
    } finally {
      client.release();
    }
  }
}

export default MetricsRepository.getInstance();
