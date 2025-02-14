import Redis from 'ioredis';
import { CONFIG } from '../config';

export const redisConfig = new Redis({
  host: CONFIG.REDIS.HOST,
  port: CONFIG.REDIS.PORT,
  password: CONFIG.REDIS.PASSWORD,
  db: CONFIG.REDIS.DB,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  }
});

redisConfig.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redisConfig.on('connect', () => {
  console.log('Successfully connected to Redis');
});

export default redisConfig;
