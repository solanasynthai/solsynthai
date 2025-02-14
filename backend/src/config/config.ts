import { z } from 'zod'
import { ConfigurationError } from '../utils/errors'
import { logger } from '../utils/logger'

const configSchema = z.object({
  app: z.object({
    port: z.coerce.number().int().min(1).max(65535),
    nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
    apiVersion: z.string().regex(/^v\d+$/),
    corsOrigin: z.string().url(),
  }),

  solana: z.object({
    network: z.enum(['mainnet-beta', 'testnet', 'devnet', 'localnet']),
    rpcUrl: z.string().url(),
    wsUrl: z.string().url(),
    programId: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }),

  security: z.object({
    jwtSecret: z.string().min(32),
    jwtExpiresIn: z.string(),
    rateLimitWindow: z.number().int().positive(),
    rateLimitMaxRequests: z.number().int().positive(),
  }),

  ai: z.object({
    openaiApiKey: z.string().min(1),
    model: z.string().min(1),
    maxTokens: z.number().int().positive(),
  }),

  storage: z.object({
    path: z.string().min(1),
    maxSize: z.number().int().positive(),
    backupEnabled: z.boolean(),
    backupInterval: z.number().int().positive(),
  }),

  monitoring: z.object({
    enabled: z.boolean(),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']),
  }),

  database: z.object({
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    name: z.string().min(1),
    user: z.string().min(1),
    password: z.string().min(1),
  }),

  redis: z.object({
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    password: z.string().min(1),
    db: z.number().int().min(0),
  }),

  aws: z.object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    region: z.string().min(1),
    bucketName: z.string().min(1),
  }),

  metrics: z.object({
    prometheusEnabled: z.boolean(),
    prometheusPort: z.coerce.number().int().min(1).max(65535),
    grafanaEnabled: z.boolean(),
    grafanaPort: z.coerce.number().int().min(1).max(65535),
  }),

  email: z.object({
    smtpHost: z.string().min(1),
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpUser: z.string().min(1),
    smtpPassword: z.string().min(1),
    emailFrom: z.string().email(),
  }),

  websocket: z.object({
    maxConnections: z.number().int().positive(),
    timeout: z.number().int().positive(),
    pingInterval: z.number().int().positive(),
  }),

  contract: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    maxProgramSize: z.number().int().positive(),
    computeBudgetUnits: z.number().int().positive(),
    priorityFeeLamports: z.number().int().nonnegative(),
  }),

  cache: z.object({
    ttl: z.number().int().positive(),
    maxItems: z.number().int().positive(),
    checkPeriod: z.number().int().positive(),
  }),

  api: z.object({
    rateLimit: z.number().int().positive(),
    rateWindow: z.number().int().positive(),
    timeout: z.number().int().positive(),
  }),

  security_headers: z.object({
    enabled: z.boolean(),
    cspEnabled: z.boolean(),
    helmetEnabled: z.boolean(),
  }),

  features: z.object({
    advancedAnalytics: z.boolean(),
    realtimeMonitoring: z.boolean(),
    automatedBackups: z.boolean(),
    aiGeneration: z.boolean(),
  }),
})

type Config = z.infer<typeof configSchema>

class Configuration {
  private static instance: Configuration
  private config: Config

  private constructor() {
    try {
      this.config = this.loadConfig()
      this.validateConfig()
      logger.info('Configuration loaded successfully')
    } catch (error) {
      throw new ConfigurationError('Failed to load configuration', {
        error: (error as Error).message,
      })
    }
  }

  public static getInstance(): Configuration {
    if (!Configuration.instance) {
      Configuration.instance = new Configuration()
    }
    return Configuration.instance
  }

  public get(): Config {
    return this.config
  }

  private loadConfig(): Config {
    return configSchema.parse({
      app: {
        port: process.env.PORT,
        nodeEnv: process.env.NODE_ENV,
        apiVersion: process.env.API_VERSION,
        corsOrigin: process.env.CORS_ORIGIN,
      },
      solana: {
        network: process.env.SOLANA_NETWORK,
        rpcUrl: process.env.SOLANA_RPC_URL,
        wsUrl: process.env.SOLANA_WS_URL,
        programId: process.env.PROGRAM_ID,
      },
      security: {
        jwtSecret: process.env.JWT_SECRET,
        jwtExpiresIn: process.env.JWT_EXPIRES_IN,
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'),
        rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      },
      ai: {
        openaiApiKey: process.env.OPENAI_API_KEY,
        model: process.env.AI_MODEL,
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2000'),
      },
      storage: {
        path: process.env.STORAGE_PATH,
        maxSize: parseInt(process.env.STORAGE_MAX_SIZE || '1073741824'),
        backupEnabled: process.env.STORAGE_BACKUP_ENABLED === 'true',
        backupInterval: parseInt(process.env.STORAGE_BACKUP_INTERVAL || '86400000'),
      },
      monitoring: {
        enabled: process.env.MONITORING_ENABLED === 'true',
        logLevel: process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug',
      },
      database: {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        name: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
      },
      redis: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
        bucketName: process.env.AWS_BUCKET_NAME,
      },
      metrics: {
        prometheusEnabled: process.env.PROMETHEUS_ENABLED === 'true',
        prometheusPort: process.env.PROMETHEUS_PORT,
        grafanaEnabled: process.env.GRAFANA_ENABLED === 'true',
        grafanaPort: process.env.GRAFANA_PORT,
      },
      email: {
        smtpHost: process.env.SMTP_HOST,
        smtpPort: process.env.SMTP_PORT,
        smtpUser: process.env.SMTP_USER,
        smtpPassword: process.env.SMTP_PASSWORD,
        emailFrom: process.env.EMAIL_FROM,
      },
      websocket: {
        maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '1000'),
        timeout: parseInt(process.env.WS_TIMEOUT || '30000'),
        pingInterval: parseInt(process.env.WS_PING_INTERVAL || '10000'),
      },
      contract: {
        version: process.env.CONTRACT_VERSION,
        maxProgramSize: parseInt(process.env.MAX_PROGRAM_SIZE || '1048576'),
        computeBudgetUnits: parseInt(process.env.COMPUTE_BUDGET_UNITS || '200000'),
        priorityFeeLamports: parseInt(process.env.PRIORITY_FEE_LAMPORTS || '10000'),
      },
      cache: {
        ttl: parseInt(process.env.CACHE_TTL || '300'),
        maxItems: parseInt(process.env.CACHE_MAX_ITEMS || '10000'),
        checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD || '600'),
      },
      api: {
        rateLimit: parseInt(process.env.API_RATE_LIMIT || '100'),
        rateWindow: parseInt(process.env.API_RATE_WINDOW || '900000'),
        timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      },
      security_headers: {
        enabled: process.env.SECURITY_HEADERS_ENABLED === 'true',
        cspEnabled: process.env.CSP_ENABLED === 'true',
        helmetEnabled: process.env.HELMET_ENABLED === 'true',
      },
      features: {
        advancedAnalytics: process.env.FEATURE_ADVANCED_ANALYTICS === 'true',
        realtimeMonitoring: process.env.FEATURE_REALTIME_MONITORING === 'true',
        automatedBackups: process.env.FEATURE_AUTOMATED_BACKUPS === 'true',
        aiGeneration: process.env.FEATURE_AI_GENERATION === 'true',
      },
    })
  }

  private validateConfig(): void {
    // Additional validation beyond schema checks
    this.validateSolanaEndpoints()
    this.validateStoragePath()
    this.validateSecrets()
    this.validatePorts()
  }

  private validateSolanaEndpoints(): void {
    const { rpcUrl, wsUrl } = this.config.solana
    if (!rpcUrl.includes(this.config.solana.network)) {
      throw new ConfigurationError('RPC URL does not match network')
    }
    if (!wsUrl.includes(this.config.solana.network)) {
      throw new ConfigurationError('WebSocket URL does not match network')
    }
  }

  private validateStoragePath(): void {
    const fs = require('fs')
    if (!fs.existsSync(this.config.storage.path)) {
      throw new ConfigurationError('Storage path does not exist')
    }
  }

  private validateSecrets(): void {
    const secrets = [
      this.config.security.jwtSecret,
      this.config.database.password,
      this.config.redis.password,
      this.config.aws.secretAccessKey,
      this.config.email.smtpPassword,
    ]

    for (const secret of secrets) {
      if (secret.length < 16) {
        throw new ConfigurationError('Secret too short')
      }
    }
  }

  private validatePorts(): void {
    const ports = new Set([
      this.config.app.port,
      this.config.database.port,
      this.config.redis.port,
      this.config.metrics.prometheusPort,
      this.config.metrics.grafanaPort,
      this.config.email.smtpPort,
    ])

    if (ports.size !== 6) {
      throw new ConfigurationError('Duplicate port numbers detected')
    }
  }
}

export const config = Configuration.getInstance().get()
export default config
