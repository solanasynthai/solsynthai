import { Pool, PoolClient, QueryResult } from 'pg'
import { promisify } from 'util'
import config from '../../config/config'
import { logger, logError } from '../../utils/logger'
import { DatabaseError } from '../../utils/errors'
import { MetricsService } from '../monitoring/MetricsService'

export class DatabaseService {
  private static instance: DatabaseService
  private pool: Pool
  private metrics: MetricsService
  private readonly maxRetries = 3
  private readonly retryDelay = 1000 // 1 second

  private constructor() {
    this.pool = new Pool({
      ...config.database,
      application_name: config.app.name,
      statement_timeout: 30000, // 30 seconds
      query_timeout: 30000,
      connectionTimeoutMillis: config.database.pool.connectionTimeoutMillis,
      idleTimeoutMillis: config.database.pool.idleTimeoutMillis,
      max: config.database.pool.max,
    })

    this.metrics = MetricsService.getInstance()
    this.setupPoolEvents()
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService()
    }
    return DatabaseService.instance
  }

  private setupPoolEvents(): void {
    this.pool.on('connect', (client: PoolClient) => {
      this.metrics.incrementCounter('db_connections_total')
      logger.debug('New database connection established', {
        pid: client.processID,
        database: config.database.database,
      })
    })

    this.pool.on('error', (err: Error, client: PoolClient) => {
      logError('Unexpected database error on idle client', err)
      this.metrics.incrementCounter('db_errors_total')
    })

    this.pool.on('remove', (client: PoolClient) => {
      logger.debug('Database connection removed from pool', {
        pid: client.processID,
      })
    })
  }

  public async connect(): Promise<void> {
    try {
      const client = await this.pool.connect()
      client.release()
      logger.info('Database connection pool initialized', {
        host: config.database.host,
        database: config.database.database,
        maxConnections: config.database.pool.max,
      })
    } catch (error) {
      logError('Failed to initialize database connection pool', error as Error)
      throw new DatabaseError('Database connection failed', { cause: error })
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.pool.end()
      logger.info('Database connection pool closed')
    } catch (error) {
      logError('Error closing database connection pool', error as Error)
      throw new DatabaseError('Database disconnection failed', { cause: error })
    }
  }

  public async query<T>(
    text: string,
    params?: unknown[],
    options: { retry?: boolean; timeout?: number } = {}
  ): Promise<QueryResult<T>> {
    const start = Date.now()
    let retries = 0

    while (true) {
      try {
        const result = await this.pool.query<T>(text, params)
        
        // Record metrics
        const duration = Date.now() - start
        this.metrics.recordHistogram('db_query_duration_seconds', duration / 1000)
        this.metrics.incrementCounter('db_queries_total')

        logger.debug('Database query executed', {
          duration,
          rows: result.rowCount,
          query: text.slice(0, 100), // Log only the first 100 chars of query
        })

        return result
      } catch (error) {
        if (!this.shouldRetry(error as Error, retries, options.retry)) {
          this.metrics.incrementCounter('db_query_errors_total')
          throw new DatabaseError('Database query failed', { cause: error })
        }

        retries++
        await this.delay(this.retryDelay * retries)
      }
    }
  }

  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect()
    const startTime = Date.now()

    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')

      const duration = Date.now() - startTime
      this.metrics.recordHistogram('db_transaction_duration_seconds', duration / 1000)
      this.metrics.incrementCounter('db_transactions_total')

      return result
    } catch (error) {
      await client.query('ROLLBACK')
      this.metrics.incrementCounter('db_transaction_rollbacks_total')
      throw new DatabaseError('Transaction failed', { cause: error })
    } finally {
      client.release()
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1')
      return true
    } catch (error) {
      logError('Database health check failed', error as Error)
      return false
    }
  }

  private shouldRetry(error: Error, retries: number, retry = true): boolean {
    if (!retry || retries >= this.maxRetries) {
      return false
    }

    const retryableErrors = [
      'connection timeout',
      'deadlock detected',
      'connection reset',
      'too many clients',
    ]

    return retryableErrors.some(msg => error.message.includes(msg))
  }

  private async delay(ms: number): Promise<void> {
    await promisify(setTimeout)(ms)
  }

  // Prepared Statement Management
  private preparedStatements = new Map<string, { text: string; name: string }>()

  public async prepare(name: string, text: string): Promise<void> {
    if (!this.preparedStatements.has(name)) {
      await this.query(`PREPARE ${name} AS ${text}`)
      this.preparedStatements.set(name, { text, name })
    }
  }

  public async execute<T>(
    name: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    if (!this.preparedStatements.has(name)) {
      throw new DatabaseError(`Prepared statement ${name} not found`)
    }
    return this.query<T>(`EXECUTE ${name}`, params)
  }

  // Batch Operations
  public async batch<T>(
    queries: { text: string; params?: unknown[] }[]
  ): Promise<QueryResult<T>[]> {
    return this.transaction(async (client) => {
      const results: QueryResult<T>[] = []
      for (const query of queries) {
        const result = await client.query<T>(query.text, query.params)
        results.push(result)
      }
      return results
    })
  }

  // Connection Pool Management
  public getTotalCount(): number {
    return this.pool.totalCount
  }

  public getIdleCount(): number {
    return this.pool.idleCount
  }

  public getWaitingCount(): number {
    return this.pool.waitingCount
  }

  public async resetPool(): Promise<void> {
    await this.disconnect()
    this.pool = new Pool(config.database)
    await this.connect()
  }
}

// Export singleton instance
export default DatabaseService.getInstance()
