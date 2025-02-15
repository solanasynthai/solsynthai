import * as dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';
import { z } from 'zod';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

// Configuration schema validation
const ConfigSchema = z.object({
  env: z.enum(['development', 'test', 'staging', 'production']),
  server: z.object({
    port: z.number().min(1).max(65535),
    host: z.string().min(1),
    cors: z.object({
      origin: z.union([z.string(), z.array(z.string())]),
      methods: z.array(z.string()),
      allowedHeaders: z.array(z.string()),
      exposedHeaders: z.array(z.string()),
      credentials: z.boolean()
    })
  }),
  database: z.object({
    host: z.string().min(1),
    port: z.number().min(1).max(65535),
    user: z.string().min(1),
    password: z.string().min(1),
    database: z.string().min(1),
    ssl: z.boolean(),
    max: z.number().min(1),
    idleTimeoutMillis: z.number().min(0)
  }),
  redis: z.object({
    url: z.string().url(),
    prefix: z.string(),
    ttl: z.number().min(0)
  }),
  solana: z.object({
    networks: z.record(z.string(), z.string().url()),
    defaultNetwork: z.string(),
    commitment: z.string(),
    maxRetries: z.number().min(0),
    confirmations: z.number().min(1)
  }),
  monitoring: z.object({
    sentry: z.object({
      dsn: z.string().url(),
      environment: z.string(),
      tracesSampleRate: z.number().min(0).max(1)
    }),
    statsd: z.object({
      host: z.string(),
      port: z.number().min(1).max(65535)
    }),
    logLevel: z.string()
  }),
  security: z.object({
    jwtSecret: z.string().min(32),
    saltRounds: z.number().min(10),
    rateLimit: z.object({
      windowMs: z.number().min(0),
      max: z.number().min(1)
    }),
    cors: z.object({
      allowedOrigins: z.array(z.string())
    })
  }),
  cache: z.object({
    defaultTTL: z.number().min(0),
    compilationTTL: z.number().min(0),
    deploymentTTL: z.number().min(0)
  }),
  compiler: z.object({
    maxSize: z.number().min(0),
    timeout: z.number().min(0),
    optimizationLevels: z.array(z.string()),
    supportedVersions: z.array(z.string())
  })
});

// Configuration object
const config = {
  env: process.env.NODE_ENV || 'development',
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Total-Count'],
      credentials: true
    }
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'solsynthai',
    ssl: process.env.DB_SSL === 'true',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10)
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: 'solsynthai:',
    ttl: parseInt(process.env.REDIS_TTL || '3600', 10)
  },
  solana: {
    networks: {
      mainnet: process.env.SOLANA_MAINNET_URL || 'https://api.mainnet-beta.solana.com',
      testnet: process.env.SOLANA_TESTNET_URL || 'https://api.testnet.solana.com',
      devnet: process.env.SOLANA_DEVNET_URL || 'https://api.devnet.solana.com',
      localnet: 'http://localhost:8899'
    },
    defaultNetwork: process.env.SOLANA_DEFAULT_NETWORK || 'devnet',
    commitment: 'confirmed',
    maxRetries: 3,
    confirmations: 1
  },
  monitoring: {
    sentry: {
      dsn: process.env.SENTRY_DSN || '',
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1')
    },
    statsd: {
      host: process.env.STATSD_HOST || 'localhost',
      port: parseInt(process.env.STATSD_PORT || '8125', 10)
    },
    logLevel: process.env.LOG_LEVEL || 'info'
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    saltRounds: parseInt(process.env.SALT_ROUNDS || '12', 10),
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10)
    },
    cors: {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || []
    }
  },
  cache: {
    defaultTTL: parseInt(process.env.CACHE_TTL || '3600', 10),
    compilationTTL: parseInt(process.env.COMPILATION_CACHE_TTL || '86400', 10),
    deploymentTTL: parseInt(process.env.DEPLOYMENT_CACHE_TTL || '3600', 10)
  },
  compiler: {
    maxSize: parseInt(process.env.MAX_CONTRACT_SIZE || '1048576', 10), // 1MB
    timeout: parseInt(process.env.COMPILATION_TIMEOUT || '30000', 10),
    optimizationLevels: ['speed', 'size', 'balanced'],
    supportedVersions: ['1.75.0', '1.74.0', '1.73.0']
  }
} as const;

// Validate configuration
try {
  ConfigSchema.parse(config);
} catch (error) {
  logger.error('Configuration validation failed', { error });
  process.exit(1);
}

// Connection cache for Solana networks
const connections: Record<string, Connection> = {};

// Helper functions
export const getConnection = (network: string = config.solana.defaultNetwork): Connection => {
  if (!connections[network]) {
    connections[network] = new Connection(config.solana.networks[network], {
      commitment: config.solana.commitment as any,
      confirmTransactionInitialTimeout: 60000
    });
  }
  return connections[network];
};

export const validateConfig = (): void => {
  // Additional validation logic
  if (config.env === 'production') {
    if (config.security.jwtSecret === 'your-secret-key') {
      throw new Error('JWT secret must be changed in production');
    }
    if (!config.monitoring.sentry.dsn) {
      throw new Error('Sentry DSN is required in production');
    }
    if (config.database.password === '') {
      throw new Error('Database password is required in production');
    }
  }
};

// Initialize configuration
validateConfig();

export { config };
export type Config = typeof config;
