import { UsageTracker } from '../../../services/analytics/UsageTracker';
import { redisConfig } from '../../../config/redis.config';
import { metrics } from '../../../utils/metrics';

describe('UsageTracker', () => {
  let usageTracker: UsageTracker;

  beforeEach(() => {
    usageTracker = new UsageTracker();
  });

  afterEach(async () => {
    await redisConfig.flushdb();
    jest.clearAllMocks();
  });

  describe('Contract Generation Tracking', () => {
    it('should track successful contract generation', async () => {
      const userId = 'test-user';
      const prompt = {
        toString: () => 'Create a token contract',
        type: 'token',
        parameters: { name: 'Test Token', symbol: 'TEST' }
      };

      await usageTracker.trackContractGeneration(
        userId,
        prompt,
        'gpt-4',
        true
      );

      const stats = await usageTracker.getUserStats(userId);
      expect(stats.contract_generation.total_requests).toBe(1);
      expect(stats.contract_generation.successful_requests).toBe(1);
    });

    it('should enforce quota limits', async () => {
      const userId = 'test-user';
      const prompt = {
        toString: () => 'A'.repeat(10000), // Large prompt
        type: 'token',
        parameters: { name: 'Test Token', symbol: 'TEST' }
      };

      await expect(
        usageTracker.trackContractGeneration(userId, prompt, 'gpt-4', true)
      ).rejects.toThrow('Token quota exceeded');
    });
  });

  describe('Usage Statistics', () => {
    it('should calculate correct usage statistics', async () => {
      const userId = 'test-user';
      const prompts = [
        { toString: () => 'Contract 1', type: 'token' },
        { toString: () => 'Contract 2', type: 'nft' },
        { toString: () => 'Contract 3', type: 'marketplace' }
      ];

      for (const prompt of prompts) {
        await usageTracker.trackContractGeneration(
          userId,
          prompt,
          'gpt-4',
          true
        );
      }

      const stats = await usageTracker.getUserStats(userId);
      expect(stats.contract_generation.total_requests).toBe(3);
      expect(stats.contract_generation.models['gpt-4'].requests).toBe(3);
    });

    it('should cache statistics correctly', async () => {
      const userId = 'test-user';
      const prompt = {
        toString: () => 'Test contract',
        type: 'token'
      };

      await usageTracker.trackContractGeneration(
        userId,
        prompt,
        'gpt-4',
        true
      );

      const stats1 = await usageTracker.getUserStats(userId);
      const stats2 = await usageTracker.getUserStats(userId);

      expect(stats1).toEqual(stats2);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track metrics correctly', async () => {
      const metricsSpy = jest.spyOn(metrics, 'increment');
      const userId = 'test-user';
      const prompt = {
        toString: () => 'Test contract',
        type: 'token'
      };

      await usageTracker.trackContractGeneration(
        userId,
        prompt,
        'gpt-4',
        true
      );

      expect(metricsSpy).toHaveBeenCalledWith(
        'usage_tracking.attempt',
        expect.any(Object)
      );
    });
  });
});
