import { Logger } from '../../utils/logger';
import { metrics } from '../../utils/metrics';
import { redisConfig } from '../../config/redis.config';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TestLogger');
  });

  afterEach(async () => {
    await logger.flush();
    await redisConfig.flushdb();
    jest.clearAllMocks();
  });

  describe('Log Levels', () => {
    it('should log messages at different levels', async () => {
      const metricsSpy = jest.spyOn(metrics, 'increment');
      
      await Promise.all([
        logger.info('Info message', { test: true }),
        logger.error('Error message', { error: new Error('Test error') }),
        logger.warn('Warning message'),
        logger.debug('Debug message'),
      ]);

      expect(metricsSpy).toHaveBeenCalledWith('logger.info', { context: 'TestLogger' });
      expect(metricsSpy).toHaveBeenCalledWith('logger.error', { context: 'TestLogger' });
      expect(metricsSpy).toHaveBeenCalledWith('logger.warn', { context: 'TestLogger' });
      expect(metricsSpy).toHaveBeenCalledWith('logger.debug', { context: 'TestLogger' });
    });
  });

  describe('Log Caching', () => {
    it('should cache logs in Redis', async () => {
      const testMessage = 'Test cache message';
      await logger.info(testMessage);

      const cachedLogs = await logger.getLoggedMessages('info', 1);
      expect(cachedLogs).toHaveLength(1);
      expect(cachedLogs[0].message).toBe(testMessage);
    });
  });

  describe('Performance Profiling', () => {
    it('should measure execution time', async () => {
      const metricsSpy = jest.spyOn(metrics, 'timing');
      
      const endProfile = await logger.profile('test-operation');
      await new Promise(resolve => setTimeout(resolve, 100));
      await endProfile();

      expect(metricsSpy).toHaveBeenCalledWith(
        'logger.profile.duration',
        expect.any(Number),
        { name: 'test-operation', context: 'TestLogger' }
      );
    });
  });
});
