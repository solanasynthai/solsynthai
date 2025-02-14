import { Pool, PoolClient, QueryResult } from 'pg'
import { DatabaseError } from '../../utils/errors'
import { logger, logError } from '../../utils/logger'
import { MetricsService } from '../monitoring/MetricsService'
import config from '../../config/config'

export class DatabaseService {
  private static instance: DatabaseService
  private pool: Pool
  private metrics: MetricsService
  private isConnected: boolean = false

  private readonly MAX_POOL_SIZE = 20
  private readonly IDLE_TIMEOUT = 10000
  private readonly CONNECTION_TIMEOUT = 5000
  private readonly MAX_RETRIES = 3
  private readonly RETRY_DELAY = 1000

  private constructor() {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      max: this.MAX_POOL_SIZE,
      idleTimeoutMillis: this.IDLE_TIMEOUT,
      connectionTimeoutMillis: this.CONNECTION_TIMEOUT,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: process.env.DB_CA_CERT
      } : undefined
    })

    this.metrics = MetricsService.getInstance()
    this.setupEventHandlers()
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService()
    }
    return DatabaseService.instance
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return

    try {
      const client = await this.pool.connect()
      client.release()
      this.isConnected = true
      logger.info('Database connection established')
      this.metrics.gauge('database_connections', this.pool.totalCount)
    } catch (error) {
      logError('Database connection failed', error as Error)
      throw new DatabaseError('Failed to connect to database')
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) return

    try {
      await this.pool.end()
      this.isConnected = false
      logger.info('Database connection closed')
    } catch (error) {
      logError('Database disconnection failed', error as Error)
      throw new DatabaseError('Failed to disconnect from database')
    }
  }

  public async query<T>(
    sql: string,
    params?: any[],
    options: {
      usePrepared?: boolean;
      useTransaction?: boolean;
    } = {}
  ): Promise<QueryResult<T>> {
    const startTime = performance.now()

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      let client: PoolClient | null = null
      let result: QueryResult<T>

      if (options.useTransaction) {
        client = await this.pool.connect()
        await client.query('BEGIN')
      }

      try {
        if (options.usePrepared) {
          const preparedName = this.generatePreparedName(sql)
          await this.prepareStatement(preparedName, sql)
          result = await (client || this.pool).query({
            name: preparedName,
            text: sql,
            values: params
          })
        } else {
          result = await (client || this.pool).query(sql, params)
        }

        if (options.useTransaction && client) {
          await client.query('COMMIT')
        }

        this.recordMetrics('success', startTime)
        return result

      } catch (error) {
        if (options.useTransaction && client) {
          await client.query('ROLLBACK')
        }
        throw error

      } finally {
        if (client) {
          client.release()
        }
      }

    } catch (error) {
      this.recordMetrics('error', startTime)
      logError('Database query failed', error as Error)
      throw new DatabaseError('Query execution failed', {
        query: this.sanitizeQuery(sql),
        error: (error as Error).message
      })
    }
  }

  public async batch<T>(
    queries: { sql: string; params?: any[] }[]
  ): Promise<QueryResult<T>[]> {
    const startTime = performance.now()
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const results = []

      for (const query of queries) {
        const result = await client.query(query.sql, query.params)
        results.push(result)
      }

      await client.query('COMMIT')
      this.recordMetrics('success', startTime)
      return results

    } catch (error) {
      await client.query('ROLLBACK')
      this.recordMetrics('error', startTime)
      logError('Database batch operation failed', error as Error)
      throw new DatabaseError('Batch operation failed')

    } finally {
      client.release()
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  private setupEventHandlers(): void {
    this.pool.on('connect', () => {
      this.metrics.increment('database_connections_total')
    })

    this.pool.on('error', (error: Error) => {
      logError('Database pool error', error)
      this.metrics.increment('database_errors_total')
    })

    this.pool.on('remove', () => {
      this.metrics.decrement('database_connections_total')
    })
  }

  private async prepareStatement(
    name: string,
    sql: string
  ): Promise<void> {
    try {
      await this.pool.query({
        name,
        text: `PREPARE ${name} AS ${sql}`
      })
    } catch (error) {
      logError('Failed to prepare statement', error as Error)
      throw new DatabaseError('Statement preparation failed')
    }
  }

  private generatePreparedName(sql: string): string {
    return `stmt_${require('crypto')
      .createHash('md5')
      .update(sql)
      .digest('hex')
      .substring(0, 10)}`
  }

  private sanitizeQuery(sql: string): string {
    return sql
      .replace(/\s+/g, ' ')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
  }

  private recordMetrics(
    status: 'success' | 'error',
    startTime: number
  ): void {
    const duration = performance.now() - startTime
    this.metrics.gauge('database_query_duration', duration)
    this.metrics.increment(`database_queries_${status}_total`)
    this.metrics.gauge('database_pool_size', this.pool.totalCount)
    this.metrics.gauge('database_pool_idle', this.pool.idleCount)
  }

  public async runMigrations(): Promise<void> {
    const migrationClient = await this.pool.connect()
    
    try {
      await migrationClient.query('BEGIN')

      // Create migrations table if it doesn't exist
      await migrationClient.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // Get list of applied migrations
      const { rows: appliedMigrations } = await migrationClient.query(
        'SELECT name FROM migrations'
      )
      const applied = new Set(appliedMigrations.map(row => row.name))

      // Get list of migration files
      const fs = require('fs')
      const path = require('path')
      const migrationsDir = path.join(__dirname, '../../../migrations')
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort()

      // Apply new migrations
      for (const file of files) {
        if (!applied.has(file)) {
          const sql = fs.readFileSync(
            path.join(migrationsDir, file),
            'utf8'
          )

          await migrationClient.query(sql)
          await migrationClient.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [file]
          )

          logger.info(`Applied migration: ${file}`)
        }
      }

      await migrationClient.query('COMMIT')
      logger.info('Database migrations completed')

    } catch (error) {
      await migrationClient.query('ROLLBACK')
      logError('Database migration failed', error as Error)
      throw new DatabaseError('Migration failed')

    } finally {
      migrationClient.release()
    }
  }
}
