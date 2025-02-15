import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

import { config } from './config';
import { logger } from './utils/logger';
import { errorMiddleware } from './utils/errors';
import MetricsService from './services/monitoring/MetricsService';
import { initializeDatabase } from './database';

// Import routes
import contractRoutes from './routes/contracts';
import deploymentRoutes from './routes/deployments';
import analyticsRoutes from './routes/analytics';
import authRoutes from './routes/auth';

export class Application {
  private app: Express;
  private server: any;
  private wss: WebSocketServer;
  private metricsService: typeof MetricsService;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.metricsService = MetricsService;
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Initialize Sentry for error tracking
    Sentry.init({
      dsn: config.monitoring.sentry.dsn,
      environment: config.env,
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app: this.app }),
        new ProfilingIntegration(),
      ],
      tracesSampleRate: config.monitoring.sentry.tracesSampleRate,
    });

    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: config.server.cors.origin,
      methods: config.server.cors.methods,
      allowedHeaders: config.server.cors.allowedHeaders,
      exposedHeaders: config.server.cors.exposedHeaders,
      credentials: config.server.cors.credentials,
    }));

    // Rate limiting
    this.app.use(rateLimit({
      windowMs: config.security.rateLimit.windowMs,
      max: config.security.rateLimit.max,
      message: 'Too many requests from this IP, please try again later.',
    }));

    // Performance middleware
    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request tracking
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.metricsService.timing('http.request', duration, {
          path: req.path,
          method: req.method,
          status: res.statusCode.toString(),
        });
      });
      next();
    });

    // Sentry request handler
    this.app.use(Sentry.Handlers.requestHandler());
    this.app.use(Sentry.Handlers.tracingHandler());
  }

  private initializeRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // API routes
    this.app.use('/api/v1/contracts', contractRoutes);
    this.app.use('/api/v1/deployments', deploymentRoutes);
    this.app.use('/api/v1/analytics', analyticsRoutes);
    this.app.use('/api/v1/auth', authRoutes);

    // WebSocket connection handler
    this.wss.on('connection', (ws) => {
      logger.info('New WebSocket connection established');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          logger.error('WebSocket message handling error:', { error });
        }
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', { error });
      });

      ws.on('close', () => {
        logger.info('WebSocket connection closed');
      });
    });
  }

  private initializeErrorHandling(): void {
    // Sentry error handler
    this.app.use(Sentry.Handlers.errorHandler());

    // Custom error middleware
    this.app.use(errorMiddleware);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Resource not found'
      });
    });
  }

  private async handleWebSocketMessage(ws: any, data: any): Promise<void> {
    switch (data.type) {
      case 'subscribe':
        // Handle subscription requests
        if (data.channel) {
          ws.channel = data.channel;
          logger.info('Client subscribed to channel:', { channel: data.channel });
        }
        break;

      case 'compilation':
        // Handle compilation status updates
        this.broadcastToChannel('compilation', data);
        break;

      case 'deployment':
        // Handle deployment status updates
        this.broadcastToChannel('deployment', data);
        break;

      default:
        logger.warn('Unknown WebSocket message type:', { type: data.type });
    }
  }

  private broadcastToChannel(channel: string, data: any): void {
    this.wss.clients.forEach((client: any) => {
      if (client.channel === channel) {
        client.send(JSON.stringify(data));
      }
    });
  }

  public async start(): Promise<void> {
    try {
      // Initialize database connection
      await initializeDatabase();

      // Start the server
      this.server.listen(config.server.port, config.server.host, () => {
        logger.info(`Server running at http://${config.server.host}:${config.server.port}`);
      });

      // Handle graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
    } catch (error) {
      logger.error('Failed to start application:', { error });
      process.exit(1);
    }
  }

  private async shutdown(): Promise<void> {
    logger.info('Shutting down application...');

    // Close WebSocket server
    this.wss.close(() => {
      logger.info('WebSocket server closed');
    });

    // Close HTTP server
    this.server.close(() => {
      logger.info('HTTP server closed');
    });

    // Allow graceful shutdown (e.g., finish processing requests)
    const timeout = setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);

    timeout.unref();
  }
}

// Create and export application instance
export const app = new Application();

// Start the application if this is the main module
if (require.main === module) {
  app.start().catch((error) => {
    logger.error('Application startup failed:', { error });
    process.exit(1);
  });
}
