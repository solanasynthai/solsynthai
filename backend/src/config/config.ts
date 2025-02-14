import { cleanEnv, str, num, bool, url, email } from 'envalid'
import { config as dotenvConfig } from 'dotenv'

// Load environment variables
dotenvConfig()

// Validate and transform environment variables
const env = cleanEnv(process.env, {
  // Application
  NODE_ENV: str({ choices: ['development', 'production', 'test'] }),
  APP_VERSION: str({ default: '1.0.0' }),
  APP_NAME: str({ default: 'SolSynthai' }),
  APP_PORT: num({ default: 4000 }),
  API_PREFIX: str({ default: '/api' }),
  COOKIE_SECRET: str(),
  CORS_ORIGIN: str(),
  REQUEST_LIMIT: str({ default: '10mb' }),
  RATE_LIMIT_WINDOW: num({ default: 900000 }), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: num({ default: 100 }),

  // Authentication
  JWT_SECRET: str(),
  JWT_EXPIRATION: str({ default: '1h' }),
  REFRESH_TOKEN_SECRET: str(),
  REFRESH_TOKEN_EXPIRATION: str({ default: '7d' }),
  PASSWORD_SALT_ROUNDS: num({ default: 12 }),

  // Database
  DB_HOST: str(),
  DB_PORT: num({ default: 5432 }),
  DB_NAME: str(),
  DB_USER: str(),
  DB_PASSWORD: str(),
  DB_SSL: bool({ default: true }),
  DB_MAX_CONNECTIONS: num({ default: 20 }),
  DB_IDLE_TIMEOUT: num({ default: 30000 }),
  DB_CONNECTION_TIMEOUT: num({ default: 2000 }),

  // Redis Cache
  REDIS_HOST: str(),
  REDIS_PORT: num({ default: 6379 }),
  REDIS_PASSWORD: str(),
  REDIS_DB: num({ default: 0 }),
  REDIS_TLS: bool({ default: true }),
  REDIS_RECONNECT_ATTEMPTS: num({ default: 10 }),
  REDIS_RECONNECT_DELAY: num({ default: 3000 }),

  // WebSocket
  WS_MAX_CONNECTIONS: num({ default: 1000 }),
  WS_PING_INTERVAL: num({ default: 30000 }),
  WS_TIMEOUT: num({ default: 120000 }),
  WS_MESSAGE_SIZE_LIMIT: num({ default: 5242880 }), // 5MB

  // AI Service
  AI_API_KEY: str(),
  AI_API_ENDPOINT: url(),
  AI_API_VERSION: str({ default: 'v1' }),
  AI_REQUEST_TIMEOUT: num({ default: 30000 }),
  AI_MAX_TOKENS: num({ default: 2048 }),
  AI_TEMPERATURE: num({ default: 0.7 }),

  // Solana
  SOLANA_RPC_URL: url(),
  SOLANA_NETWORK: str({ choices: ['mainnet-beta', 'testnet', 'devnet'] }),
  SOLANA_WALLET_SECRET: str(),
  SOLANA_COMMITMENT: str({ choices: ['processed', 'confirmed', 'finalized'] }),

  // Monitoring
  METRICS_ENABLED: bool({ default: true }),
  METRICS_PREFIX: str({ default: 'solsynthai_' }),
  LOG_LEVEL: str({ choices: ['debug', 'info', 'warn', 'error'] }),
  SENTRY_DSN: str({ default: '' }),
  SENTRY_ENVIRONMENT: str({ default: 'production' }),
  SENTRY_TRACES_SAMPLE_RATE: num({ default: 0.1 }),

  // Security
  SECURITY_HEADERS_ENABLED: bool({ default: true }),
  CSP_ENABLED: bool({ default: true }),
  RATE_LIMITER_ENABLED: bool({ default: true }),
  MAX_REQUEST_SIZE: str({ default: '10mb' }),
  SSL_KEY_PATH: str({ default: '' }),
  SSL_CERT_PATH: str({ default: '' }),
  IP_WHITELIST: str({ default: '' }),

  // Admin
  ADMIN_EMAIL: email(),
  SUPPORT_EMAIL: email({ default: 'support@solsynthai.com' }),
})

export const config = {
  app: {
    env: env.NODE_ENV,
    version: env.APP_VERSION,
    name: env.APP_NAME,
    port: env.APP_PORT,
    apiPrefix: env.API_PREFIX,
    cookieSecret: env.COOKIE_SECRET,
    corsOrigin: env.CORS_ORIGIN.split(','),
    requestLimit: env.REQUEST_LIMIT,
  },

  auth: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiration: env.JWT_EXPIRATION,
    refreshTokenSecret: env.REFRESH_TOKEN_SECRET,
    refreshTokenExpiration: env.REFRESH_TOKEN_EXPIRATION,
    passwordSaltRounds: env.PASSWORD_SALT_ROUNDS,
  },

  database: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL,
    pool: {
      max: env.DB_MAX_CONNECTIONS,
      idleTimeoutMillis: env.DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT,
    },
    migrations: {
      directory: './src/database/migrations',
      tableName: 'migrations',
    },
  },

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    tls: env.REDIS_TLS ? {} : undefined,
    maxRetriesPerRequest: env.REDIS_RECONNECT_ATTEMPTS,
    retryStrategy: (times: number) => {
      if (times > env.REDIS_RECONNECT_ATTEMPTS) return null
      return Math.min(times * env.REDIS_RECONNECT_DELAY, 10000)
    },
  },

  websocket: {
    maxConnections: env.WS_MAX_CONNECTIONS,
    pingInterval: env.WS_PING_INTERVAL,
    timeout: env.WS_TIMEOUT,
    messageSizeLimit: env.WS_MESSAGE_SIZE_LIMIT,
  },

  ai: {
    apiKey: env.AI_API_KEY,
    apiEndpoint: env.AI_API_ENDPOINT,
    apiVersion: env.AI_API_VERSION,
    requestTimeout: env.AI_REQUEST_TIMEOUT,
    maxTokens: env.AI_MAX_TOKENS,
    temperature: env.AI_TEMPERATURE,
  },

  solana: {
    rpcUrl: env.SOLANA_RPC_URL,
    network: env.SOLANA_NETWORK,
    walletSecret: env.SOLANA_WALLET_SECRET,
    commitment: env.SOLANA_COMMITMENT,
  },

  monitoring: {
    metricsEnabled: env.METRICS_ENABLED,
    metricsPrefix: env.METRICS_PREFIX,
    logLevel: env.LOG_LEVEL,
    sentry: {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    },
  },

  security: {
    headersEnabled: env.SECURITY_HEADERS_ENABLED,
    cspEnabled: env.CSP_ENABLED,
    rateLimiter: {
      enabled: env.RATE_LIMITER_ENABLED,
      windowMs: env.RATE_LIMIT_WINDOW,
      max: env.RATE_LIMIT_MAX_REQUESTS,
    },
    ssl: {
      keyPath: env.SSL_KEY_PATH,
      certPath: env.SSL_CERT_PATH,
    },
    ipWhitelist: env.IP_WHITELIST ? env.IP_WHITELIST.split(',') : [],
  },

  admin: {
    email: env.ADMIN_EMAIL,
    supportEmail: env.SUPPORT_EMAIL,
  },

  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
} as const

export default config
