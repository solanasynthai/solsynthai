import { StatsD } from 'node-statsd';
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';
import { Redis } from 'ioredis';
import { MetricsRepository } from '../../repositories/MetricsRepository';
import { logger } from '../../utils/logger';
import { config } from '../../config';

export class MetricsService {
  private static instance: MetricsService;
  private statsd: StatsD;
  private redis: Redis;
  private metricsRepo: MetricsRepository;
  private readonly METRICS_PREFIX = 'solsynthai.';
  private readonly RATE_LIMIT_PREFIX = 'rate_limit:';
  private readonly METRICS_FLUSH_INTERVAL = 10000; // 10 seconds
  private readonly ERROR_THRESHOLD = 0.05; // 5% error rate threshold

  private constructor() {
    // Initialize StatsD client
    this.statsd = new StatsD({
      host: config.monitoring.statsd.host,
      port: config.monitoring.statsd.port,
      prefix: this.METRICS_PREFIX,
      errorHandler: (error) => {
        logger.error('StatsD error:', { error });
      },
      bufferFlushInterval: this.METRICS_FLUSH_INTERVAL
    });

    // Initialize Redis connection
    this.redis = new Redis(config.redis.url, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      enableReadyCheck: true
    });

    // Initialize Metrics Repository
    this.metricsRepo = MetricsRepository.getInstance();

    // Initialize Sentry
    this.initializeSentry();

    // Start background tasks
    this.startBackgroundTasks();
  }

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public increment(metric: string, tags: Record<string, string> = {}): void {
    try {
      const formattedTags = this.formatTags(tags);
      this.statsd.increment(`${metric}${formattedTags}`);
    } catch (error) {
      logger.error('Failed to increment metric', { metric, tags, error });
    }
  }

  public gauge(metric: string, value: number, tags: Record<string, string> = {}): void {
    try {
      const formattedTags = this.formatTags(tags);
      this.statsd.gauge(`${metric}${formattedTags}`, value);
    } catch (error) {
      logger.error('Failed to record gauge', { metric, value, tags, error });
    }
  }

  public timing(metric: string, duration: number, tags: Record<string, string> = {}): void {
    try {
      const formattedTags = this.formatTags(tags);
      this.statsd.timing(`${metric}${formattedTags}`, duration);
    } catch (error) {
      logger.error('Failed to record timing', { metric, duration, tags, error });
    }
  }

  public async trackRateLimit(
    key: string,
    limit: number,
    window: number
  ): Promise<boolean> {
    const now = Date.now();
    const rateKey = `${this.RATE_LIMIT_PREFIX}${key}`;

    try {
      const multi = this.redis.multi();
      multi.zadd(rateKey, now, now.toString());
      multi.zremrangebyscore(rateKey, 0, now - window);
      multi.zcard(rateKey);
      multi.expire(rateKey, Math.ceil(window / 1000));

      const results = await multi.exec();
      if (!results) return false;

      const count = results[2][1] as number;
      return count <= limit;
    } catch (error) {
      logger.error('Rate limit check failed', { key, error });
      return false;
    }
  }

  public async recordError(
    error: Error,
    context: Record<string, any> = {}
  ): Promise<void> {
    try {
      // Record in StatsD
      this.increment('errors', {
        type: error.name,
        ...context
      });

      // Record in Sentry
      Sentry.captureException(error, {
        extra: context
      });

      // Store in database for analysis
      await this.metricsRepo.saveError({
        type: error.name,
        message: error.message,
        stack: error.stack,
        context,
        timestamp: new Date()
      });

      // Check error threshold
      await this.checkErrorThreshold(error.name);
    } catch (e) {
      logger.error('Failed to record error', { originalError: error, recordingError: e });
    }
  }

  public startTransaction(name: string, op?: string): Sentry.Transaction {
    return Sentry.startTransaction({
      name,
      op
    });
  }

  public recordHealthCheck(
    service: string,
    status: 'up' | 'down',
    responseTime?: number
  ): void {
    this.gauge(`health.${service}`, status === 'up' ? 1 : 0);
    if (responseTime) {
      this.timing(`health.${service}.response_time`, responseTime);
    }
  }

  public async getMetricsSummary(
    timeframe: number = 3600
  ): Promise<Record<string, any>> {
    try {
      const end = Date.now();
      const start = end - (timeframe * 1000);

      const [errors, performance, health] = await Promise.all([
        this.metricsRepo.getErrorMetrics(start, end),
        this.metricsRepo.getPerformanceMetrics(start, end),
        this.metricsRepo.getHealthMetrics(start, end)
      ]);

      return {
        timestamp: new Date(),
        timeframe,
        errors: {
          total: errors.total,
          byType: errors.byType,
          rate: errors.rate
        },
        performance: {
          averageResponseTime: performance.avgResponseTime,
          p95ResponseTime: performance.p95ResponseTime,
          requestRate: performance.requestRate
        },
        health: {
          uptime: health.uptime,
          services: health.services
        }
      };
    } catch (error) {
      logger.error('Failed to get metrics summary', { error });
      throw error;
    }
  }

  private initializeSentry(): void {
    Sentry.init({
      dsn: config.monitoring.sentry.dsn,
      environment: config.env,
      integrations: [
        new ProfilingIntegration()
      ],
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1
    });
  }

  private startBackgroundTasks(): void {
    // Flush metrics periodically
    setInterval(() => {
      this.flushMetrics();
    }, this.METRICS_FLUSH_INTERVAL);

    // Clean up old rate limit data
    setInterval(() => {
      this.cleanupRateLimits();
    }, 3600000); // Every hour
  }

  private async flushMetrics(): Promise<void> {
    try {
      const metrics = await this.metricsRepo.getPendingMetrics();
      if (metrics.length > 0) {
        await Promise.all(
          metrics.map(metric => this.recordMetric(metric))
        );
      }
    } catch (error) {
      logger.error('Failed to flush metrics', { error });
    }
  }

  private async cleanupRateLimits(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.RATE_LIMIT_PREFIX}*`);
      for (const key of keys) {
        const now = Date.now();
        await this.redis.zremrangebyscore(key, 0, now - 86400000); // Remove entries older than 24 hours
      }
    } catch (error) {
      logger.error('Failed to cleanup rate limits', { error });
    }
  }

  private async checkErrorThreshold(errorType: string): Promise<void> {
    try {
      const errorRate = await this.metricsRepo.getErrorRate(errorType, 300); // 5 minutes
      if (errorRate > this.ERROR_THRESHOLD) {
        logger.warn('Error rate exceeded threshold', { errorType, rate: errorRate });
        // Alert via Sentry
        Sentry.captureMessage(`Error rate threshold exceeded for ${errorType}`, {
          level: 'warning',
          extra: { errorRate }
        });
      }
    } catch (error) {
      logger.error('Failed to check error threshold', { error });
    }
  }

  private async recordMetric(metric: any): Promise<void> {
    try {
      switch (metric.type) {
        case 'counter':
          this.statsd.increment(metric.name, metric.value, metric.sampleRate);
          break;
        case 'gauge':
          this.statsd.gauge(metric.name, metric.value);
          break;
        case 'timing':
          this.statsd.timing(metric.name, metric.value);
          break;
        default:
          logger.warn('Unknown metric type', { metric });
      }
    } catch (error) {
      logger.error('Failed to record metric', { metric, error });
    }
  }

  private formatTags(tags: Record<string, string>): string {
    if (Object.keys(tags).length === 0) return '';
    return '.' + Object.entries(tags)
      .map(([key, value]) => `${key}:${value}`)
      .join('.');
  }
}

export default MetricsService.getInstance();
