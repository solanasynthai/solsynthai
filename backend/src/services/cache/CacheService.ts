import Redis, { Redis as RedisClient } from 'ioredis'
import { ServiceUnavailableError } from '../../utils/errors'
import { logger, logError } from '../../utils/logger'
import { MetricsService } from '../monitoring/MetricsService'
import config from '../../config/config'

interface CacheOptions {
  ttl?: number
  tags?: string[]
}

export class CacheService {
  private static instance: CacheService
  private client: RedisClient
  private metrics: MetricsService
  private isConnected: boolean = false

  private readonly DEFAULT_TTL = config.cache.ttl
  private readonly MAX_KEY_LENGTH = 256
  private readonly MAX_VALUE_SIZE = 512 * 1024 // 512KB
  private readonly RECONNECT_ATTEMPTS = 5
  private readonly RECONNECT_DELAY = 1000
  private readonly COMMAND_TIMEOUT = 5000
  private readonly KEEP_ALIVE_INTERVAL = 30000

  private constructor() {
    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times) => {
        if (times > this.RECONNECT_ATTEMPTS) {
          return null // Stop retrying
        }
        return Math.min(times * this.RECONNECT_DELAY, 5000)
      },
      commandTimeout: this.COMMAND_TIMEOUT,
      keepAlive: this.KEEP_ALIVE_INTERVAL,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      reconnectOnError: (err) => {
        const targetError = 'READONLY'
        if (err.message.includes(targetError)) {
          return true // Force reconnect on READONLY error
        }
        return false
      },
      tls: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: process.env.REDIS_CA_CERT
      } : undefined
    })

    this.metrics = MetricsService.getInstance()
    this.setupEventHandlers()
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return

    try {
      await this.client.ping()
      this.isConnected = true
      logger.info('Cache connection established')
      this.metrics.gauge('cache_connections', 1)
    } catch (error) {
      logError('Cache connection failed', error as Error)
      throw new ServiceUnavailableError('Failed to connect to cache')
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) return

    try {
      await this.client.quit()
      this.isConnected = false
      logger.info('Cache connection closed')
      this.metrics.gauge('cache_connections', 0)
    } catch (error) {
      logError('Cache disconnection failed', error as Error)
      throw new ServiceUnavailableError('Failed to disconnect from cache')
    }
  }

  public async get<T>(key: string): Promise<T | null> {
    const startTime = performance.now()

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      const value = await this.client.get(this.normalizeKey(key))
      
      if (!value) {
        this.recordMetrics('miss', startTime)
        return null
      }

      const parsed = JSON.parse(value)
      this.recordMetrics('hit', startTime)
      return parsed as T

    } catch (error) {
      this.recordMetrics('error', startTime)
      logError('Cache get failed', error as Error)
      return null
    }
  }

  public async set(
    key: string,
    value: any,
    ttl: number = this.DEFAULT_TTL,
    options: CacheOptions = {}
  ): Promise<boolean> {
    const startTime = performance.now()

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      const normalizedKey = this.normalizeKey(key)
      const serializedValue = JSON.stringify(value)

      if (serializedValue.length > this.MAX_VALUE_SIZE) {
        throw new Error('Cache value too large')
      }

      const pipeline = this.client.pipeline()
      
      pipeline.set(normalizedKey, serializedValue, 'EX', ttl)

      if (options.tags) {
        for (const tag of options.tags) {
          pipeline.sadd(`tag:${tag}`, normalizedKey)
          pipeline.expire(`tag:${tag}`, ttl)
        }
      }

      await pipeline.exec()
      this.recordMetrics('set', startTime)
      return true

    } catch (error) {
      this.recordMetrics('error', startTime)
      logError('Cache set failed', error as Error)
      return false
    }
  }

  public async delete(key: string): Promise<boolean> {
    const startTime = performance.now()

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      const result = await this.client.del(this.normalizeKey(key))
      this.recordMetrics('delete', startTime)
      return result > 0

    } catch (error) {
      this.recordMetrics('error', startTime)
      logError('Cache delete failed', error as Error)
      return false
    }
  }

  public async invalidateTag(tag: string): Promise<boolean> {
    const startTime = performance.now()

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      const tagKey = `tag:${tag}`
      const keys = await this.client.smembers(tagKey)

      if (keys.length > 0) {
        const pipeline = this.client.pipeline()
        pipeline.del(...keys)
        pipeline.del(tagKey)
        await pipeline.exec()
      }

      this.recordMetrics('invalidate', startTime)
      return true

    } catch (error) {
      this.recordMetrics('error', startTime)
      logError('Cache tag invalidation failed', error as Error)
      return false
    }
  }

  public async flush(): Promise<boolean> {
    const startTime = performance.now()

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      await this.client.flushdb()
      this.recordMetrics('flush', startTime)
      return true

    } catch (error) {
      this.recordMetrics('error', startTime)
      logError('Cache flush failed', error as Error)
      return false
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping()
      return true
    } catch {
      return false
    }
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Cache connecting...')
    })

    this.client.on('ready', () => {
      logger.info('Cache ready')
      this.metrics.increment('cache_connections_total')
    })

    this.client.on('error', (error: Error) => {
      logError('Cache error', error)
      this.metrics.increment('cache_errors_total')
    })

    this.client.on('close', () => {
      logger.info('Cache connection closed')
      this.metrics.decrement('cache_connections_total')
    })

    this.client.on('reconnecting', () => {
      logger.info('Cache reconnecting...')
    })
  }

  private normalizeKey(key: string): string {
    if (key.length > this.MAX_KEY_LENGTH) {
      const hash = require('crypto')
        .createHash('sha256')
        .update(key)
        .digest('hex')
      return `${key.substring(0, 212)}:${hash.substring(0, 8)}`
    }
    return key
  }

  private recordMetrics(
    operation: 'hit' | 'miss' | 'set' | 'delete' | 'invalidate' | 'flush' | 'error',
    startTime: number
  ): void {
    const duration = performance.now() - startTime
    this.metrics.gauge('cache_operation_duration', duration)
    this.metrics.increment(`cache_${operation}_total`)
  }
}
