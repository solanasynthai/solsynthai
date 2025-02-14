import { Connection, Keypair } from '@solana/web3.js';
import { redisConfig } from '../config/redis.config';
import { metrics } from '../utils/metrics';
import { Logger } from '../utils/logger';
import { ConnectionPool } from '../utils/ConnectionPool';

const testLogger = new Logger('TestSetup');

beforeAll(async () => {
  // Initialize test database
  process.env.NODE_ENV = 'test';
  process.env.SOLANA_RPC_PRIMARY = 'http://localhost:8899';
  process.env.REDIS_URL = 'redis://localhost:6379/1';
  
  // Create fresh test keypairs
  global.testWallet = Keypair.generate();
  global.programWallet = Keypair.generate();
  
  // Initialize connection pool
  await ConnectionPool.getInstance().initialize({
    endpoints: [process.env.SOLANA_RPC_PRIMARY],
    commitment: 'confirmed'
  });

  // Clear Redis test database
  await redisConfig.flushdb();
  
  testLogger.info('Test environment initialized');
});

afterAll(async () => {
  await Promise.all([
    ConnectionPool.getInstance().closeAll(),
    redisConfig.quit(),
    metrics.close()
  ]);
  
  testLogger.info('Test environment cleaned up');
  await testLogger.flush();
});
