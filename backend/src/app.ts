import express, { Application } from 'express'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { createServer } from 'http'
import { promisify } from 'util'
import { DatabaseService } from './services/database/DatabaseService'
import { CacheService } from './services/cache/CacheService'
import { MetricsService } from './services/monitoring/MetricsService'
import { WebSocketService } from './services/websocket/WebSocketService'
import routes from './api/routes'
import {
  security,
  requestLogger,
  errorHandler,
  requestId,
  responseTime,
  compressionOptions
} from './api/middlewares'
import { logger, logError } from './utils/logger'
import config from './config/config'

class App {
  public app: Application
  public server: any
  private db: DatabaseService
  private cache: CacheService
  private metrics: MetricsService
  private wss: WebSocketService

  constructor() {
    this.app = express()
    this.server = createServer(this.app)
    this.db = DatabaseService.getInstance()
    this.cache = CacheService.getInstance()
    this.metrics = MetricsService.getInstance()
    this.wss = WebSocketService.getInstance(this.server)

    this.initializeMiddlewares()
    this.initializeRoutes()
    this.initializeErrorHandling()
  }

  private initializeMiddlewares(): void {
    // Security middlewares
    this.app.use(security)

    // Request processing
    this.app.use(express.json({ limit: '10mb' }))
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }))
    this.app.use(cookieParser(config.app.cookieSecret))
    this.app.use(compression(compressionOptions))

    // Logging and monitoring
    this.app.use(requestId)
    this.app.use(responseTime)
    this.app.use(requestLogger)

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      res.set('Content-Type', this.metrics.contentType)
      res.end(this.metrics.metrics())
    })

    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const [dbHealth, cacheHealth] = await Promise.all([
          this.checkDatabaseHealth(),
          this.checkCacheHealth()
        ])

        const health = {
          status: dbHealth && cacheHealth ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealth ? 'connected' : 'disconnected',
            cache: cacheHealth ? 'connected' : 'disconnected'
          }
        }

        res.status(health.status === 'healthy' ? 200 : 503).json(health)
      } catch (error) {
        logError('Health check failed', error as Error)
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: (error as Error).message
        })
      }
    })
  }

  private initializeRoutes(): void {
    this.app.use('/api', routes)
  }

  private initializeErrorHandling(): void {
    this.app.use(errorHandler)
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  private async checkCacheHealth(): Promise<boolean> {
    try {
      await this.cache.ping()
      return true
    } catch {
      return false
    }
  }

  public async start(): Promise<void> {
    try {
      // Initialize services
      await this.db.connect()
      await this.cache.connect()
      this.metrics.initialize()

      // Start HTTP server
      const listen = promisify(this.server.listen.bind(this.server))
      await listen(config.app.port)

      logger.info(`Server started on port ${config.app.port}`, {
        env: process.env.NODE_ENV,
        version: process.env.APP_VERSION
      })

      // Graceful shutdown handling
      this.setupGracefulShutdown()

    } catch (error) {
      logError('Server startup failed', error as Error)
      process.exit(1)
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown`)

      // Create HTTP server shutdown promise
      const serverClose = promisify(this.server.close.bind(this.server))

      try {
        // Stop accepting new connections
        await serverClose()
        logger.info('HTTP server closed')

        // Close WebSocket connections
        this.wss.close()
        logger.info('WebSocket server closed')

        // Disconnect from services
        await Promise.all([
          this.db.disconnect(),
          this.cache.disconnect()
        ])
        logger.info('Service connections closed')

        process.exit(0)

      } catch (error) {
        logError('Graceful shutdown failed', error as Error)
        process.exit(1)
      }
    }

    // Handle shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logError('Uncaught exception', error)
      shutdown('uncaughtException')
    })

    process.on('unhandledRejection', (reason) => {
      logError('Unhandled rejection', reason as Error)
      shutdown('unhandledRejection')
    })
  }
}

export const app = new App()
export const server = app.server

// Start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.start().catch((error) => {
    logError('Application startup failed', error)
    process.exit(1)
  })
}
