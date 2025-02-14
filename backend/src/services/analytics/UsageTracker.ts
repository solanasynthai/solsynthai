import { createClient } from '@clickhouse/client';
import { Logger } from '../../utils/logger';
import { redisConfig } from '../../config/redis.config';
import { encode } from 'gpt-3-encoder';
import { TokenCounter, ModelType } from '@anthropic-ai/tokenizer';
import { z } from 'zod';
import { metrics } from '../../utils/metrics';
import { APIError } from '../../utils/errors';
import { PromptTemplate } from '../../types/prompt';
import { CircuitBreaker } from '../../utils/circuitBreaker';

interface UsageEvent {
  userId: string;
  event: string;
  metadata: Record<string, any>;
  timestamp: Date;
  sessionId: string;
  modelType: ModelType;
  costInCredits: number;
}

export enum ModelType {
  GPT4 = 'gpt-4',
  GPT35 = 'gpt-3.5-turbo',
  CLAUDE = 'claude-2',
  CODELLAMA = 'codellama-34b',
}

export class UsageTracker {
  private logger: Logger;
  private clickhouse;
  private tokenCounter: TokenCounter;
  private metricsClient: typeof metrics;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.logger = new Logger('UsageTracker');
    this.clickhouse = createClient({
      host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: process.env.CLICKHOUSE_DB || 'solsynthai',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
      compression: {
        response: true,
        request: false
      },
      keep_alive: {
        enabled: true,
        idle_timeout: 60000
      }
    });
    this.tokenCounter = new TokenCounter();
    this.metricsClient = metrics;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeout: 60000
    });
  }

  private countTokens(text: string, modelType: ModelType): number {
    try {
      this.metricsClient.increment('token_count.attempt', { modelType });

      let tokenCount: number;
      switch (modelType) {
        case ModelType.GPT4:
        case ModelType.GPT35:
          tokenCount = encode(text).length;
          break;
        case ModelType.CLAUDE:
          tokenCount = this.tokenCounter.countTokens(text, 'claude-v2');
          break;
        case ModelType.CODELLAMA:
          tokenCount = this.tokenCounter.countTokens(text, 'codellama');
          break;
        default:
          throw new APIError('UNSUPPORTED_MODEL', `Unsupported model type: ${modelType}`);
      }

      const promptHash = this.hashPrompt(text);
      void this.cacheTokenCount(promptHash, tokenCount, modelType);

      this.metricsClient.histogram('token_count.value', tokenCount, { modelType });
      return tokenCount;
    } catch (error) {
      this.logger.error('Token counting failed', {
        error,
        modelType,
        textLength: text.length
      });
      this.metricsClient.increment('token_count.error', { modelType });
      throw error;
    }
  }

  private async cacheTokenCount(
    promptHash: string,
    tokenCount: number,
    modelType: ModelType
  ): Promise<void> {
    const cacheKey = `token_count:${modelType}:${promptHash}`;
    await redisConfig.setex(
      cacheKey,
      3600 * 24,
      tokenCount.toString(),
      {
        NX: true
      }
    );
  }

  private hashPrompt(text: string): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(text)
      .digest('hex');
  }

  private async getTokenQuota(userId: string): Promise<number> {
    const quotaKey = `quota:${userId}`;
    const userTier = await this.getUserTier(userId);
    const quotaLimits = {
      free: 100000,
      pro: 1000000,
      enterprise: Infinity
    };

    const usedTokens = parseInt(await redisConfig.get(quotaKey) || '0');
    return quotaLimits[userTier] - usedTokens;
  }

  private async getUserTier(userId: string): Promise<'free' | 'pro' | 'enterprise'> {
    const query = `
      SELECT tier
      FROM user_subscriptions
      WHERE user_id = {userId:String}
      AND current_period_end > now()
      ORDER BY current_period_end DESC
      LIMIT 1
    `;

    const result = await this.clickhouse.query({
      query,
      query_params: { userId }
    });

    return result[0]?.tier || 'free';
  }

  async trackContractGeneration(
    userId: string,
    prompt: PromptTemplate,
    modelType: ModelType,
    success: boolean
  ): Promise<void> {
    const sessionId = crypto.randomUUID();
    const tokenCount = this.countTokens(prompt.toString(), modelType);
    const remainingQuota = await this.getTokenQuota(userId);

    if (tokenCount > remainingQuota) {
      throw new APIError('QUOTA_EXCEEDED', 'Token quota exceeded');
    }

    const event: UsageEvent = {
      userId,
      event: 'contract_generation',
      metadata: {
        prompt: prompt.toString(),
        success,
        tokenCount,
        modelType,
        remainingQuota: remainingQuota - tokenCount
      },
      timestamp: new Date(),
      sessionId,
      modelType,
      costInCredits: this.calculateCost(tokenCount, modelType)
    };

    await this.circuitBreaker.execute(() => this.trackEvent(event));
    await this.updateUserQuota(userId, tokenCount);
    await this.updateUserMetrics(userId, event);
  }

  private calculateCost(tokenCount: number, modelType: ModelType): number {
    const costPerToken = {
      [ModelType.GPT4]: 0.00003,
      [ModelType.GPT35]: 0.000002,
      [ModelType.CLAUDE]: 0.000008,
      [ModelType.CODELLAMA]: 0.000001
    };

    return tokenCount * costPerToken[modelType];
  }

  private async trackEvent(event: UsageEvent): Promise<void> {
    try {
      await this.clickhouse.insert({
        table: 'usage_events',
        values: [event],
        format: 'JSONEachRow'
      });

      this.logger.info('Tracked usage event', { 
        event: event.event,
        userId: event.userId,
        sessionId: event.sessionId
      });
    } catch (error) {
      this.logger.error('Failed to track usage event', { event, error });
      this.metricsClient.increment('usage_tracking.error');
      throw new APIError('TRACKING_FAILED', 'Failed to track usage event');
    }
  }

  private async updateUserQuota(userId: string, tokenCount: number): Promise<void> {
    const quotaKey = `quota:${userId}`;
    const pipeline = redisConfig.pipeline();

    pipeline.incrby(quotaKey, tokenCount);
    pipeline.expire(quotaKey, 86400); // 24 hours TTL

    await pipeline.exec();
  }

  private async updateUserMetrics(userId: string, event: UsageEvent): Promise<void> {
    const metricsKey = `metrics:${userId}:${event.event}`;
    const pipeline = redisConfig.pipeline();

    pipeline.hincrby(metricsKey, 'total_requests', 1);
    pipeline.hincrby(metricsKey, 'total_tokens', event.metadata.tokenCount);
    pipeline.hincrby(metricsKey, 'successful_requests', event.metadata.success ? 1 : 0);
    pipeline.expire(metricsKey, 604800); // 7 days TTL

    await pipeline.exec();
  }

  async getUserStats(userId: string): Promise<Record<string, any>> {
    const cacheKey = `stats:${userId}`;
    const cachedStats = await redisConfig.get(cacheKey);

    if (cachedStats) {
      return JSON.parse(cachedStats);
    }

    const query = `
      SELECT 
        event,
        modelType,
        count(*) as count,
        sum(metadata.tokenCount) as total_tokens,
        sum(costInCredits) as total_cost,
        sum(case when metadata.success = true then 1 else 0 end) as successful_requests,
        min(timestamp) as first_request,
        max(timestamp) as last_request
      FROM usage_events
      WHERE userId = {userId:String}
      GROUP BY event, modelType
      ORDER BY last_request DESC
    `;

    try {
      const results = await this.circuitBreaker.execute(() => 
        this.clickhouse.query({
          query,
          query_params: { userId },
          format: 'JSONEachRow'
        })
      );

      const stats = this.processQueryResults(results);
      await redisConfig.setex(cacheKey, 300, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      this.logger.error('Failed to fetch user stats', { userId, error });
      throw new APIError('STATS_FETCH_FAILED', 'Failed to fetch user statistics');
    }
  }

  private processQueryResults(results: any[]): Record<string, any> {
    return results.reduce((acc, row) => {
      if (!acc[row.event]) {
        acc[row.event] = {
          total_requests: 0,
          total_tokens: 0,
          total_cost: 0,
          successful_requests: 0,
          models: {}
        };
      }

      acc[row.event].total_requests += row.count;
      acc[row.event].total_tokens += row.total_tokens;
      acc[row.event].total_cost += row.total_cost;
      acc[row.event].successful_requests += row.successful_requests;

      acc[row.event].models[row.modelType] = {
        requests: row.count,
        tokens: row.total_tokens,
        cost: row.total_cost,
        successful_requests: row.successful_requests
      };

      return acc;
    }, {});
  }
}
