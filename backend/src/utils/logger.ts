import winston from 'winston';
import { SeqTransport } from '@datalust/winston-seq';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import { LogstashTransport } from 'winston-logstash-transport';
import { Logtail } from '@logtail/node';
import { LogtailTransport } from '@logtail/winston';
import * as Sentry from '@sentry/node';
import { Client } from '@elastic/elasticsearch';
import { metrics } from './metrics';
import { redisConfig } from '../config/redis.config';
import { performance } from 'perf_hooks';
import { hostname } from 'os';

interface LogContext {
  requestId?: string;
  userId?: string;
  environment: string;
  service: string;
  version: string;
  host: string;
}

interface LogMetadata extends LogContext {
  timestamp: string;
  level: string;
  context: string;
  [key: string]: any;
}

export class Logger {
  private logger: winston.Logger;
  private logtail: Logtail;
  private elasticClient: Client;
  private readonly context: string;
  private readonly defaultContext: LogContext;
  private readonly logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
  };

  constructor(context: string) {
    this.context = context;
    this.defaultContext = {
      environment: process.env.NODE_ENV || 'development',
      service: process.env.SERVICE_NAME || 'solsynthai-backend',
      version: process.env.SERVICE_VERSION || '1.0.0',
      host: hostname()
    };

    this.initializeSentry();
    this.initializeLogtail();
    this.initializeElasticsearch();
    this.initializeLogger();
  }

  private initializeSentry() {
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV,
        release: process.env.SERVICE_VERSION,
        tracesSampleRate: 1.0,
        integrations: [
          new Sentry.Integrations.Http({ tracing: true }),
          new Sentry.Integrations.Express(),
          new Sentry.Integrations.Postgres(),
          new Sentry.Integrations.Redis(),
        ],
      });
    }
  }

  private initializeLogtail() {
    if (process.env.LOGTAIL_SOURCE_TOKEN) {
      this.logtail = new Logtail(process.env.LOGTAIL_SOURCE_TOKEN);
    }
  }

  private initializeElasticsearch() {
    if (process.env.ELASTICSEARCH_URL) {
      this.elasticClient = new Client({
        node: process.env.ELASTICSEARCH_URL,
        auth: {
          username: process.env.ELASTICSEARCH_USERNAME!,
          password: process.env.ELASTICSEARCH_PASSWORD!
        },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      });
    }
  }

  private initializeLogger() {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level}] [${this.context}]: ${message} ${
              Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
            }`;
          })
        )
      })
    ];

    if (process.env.SEQ_SERVER_URL) {
      transports.push(
        new SeqTransport({
          serverUrl: process.env.SEQ_SERVER_URL,
          apiKey: process.env.SEQ_API_KEY,
          onError: (error) => {
            console.error('Seq logging error:', error);
            metrics.increment('logger.seq.error');
          },
          handleEventsContaining: ['message', 'level', 'timestamp'],
        })
      );
    }

    if (this.elasticClient) {
      transports.push(
        new ElasticsearchTransport({
          client: this.elasticClient,
          level: 'info',
          indexPrefix: `logs-${this.defaultContext.service}`,
          indexSuffixPattern: 'YYYY.MM.DD',
          ensureMappingTemplate: true,
          flushInterval: 2000,
          bufferLimit: 1000,
        })
      );
    }

    if (process.env.LOGSTASH_HOST && process.env.LOGSTASH_PORT) {
      transports.push(
        new LogstashTransport({
          host: process.env.LOGSTASH_HOST,
          port: parseInt(process.env.LOGSTASH_PORT),
          ssl_enable: process.env.NODE_ENV === 'production',
          max_connect_retries: -1,
          timeout_connect_retries: 15000,
          applicationName: this.defaultContext.service,
        })
      );
    }

    if (this.logtail) {
      transports.push(new LogtailTransport(this.logtail));
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      levels: this.logLevels,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
        winston.format.json()
      ),
      defaultMeta: this.defaultContext,
      transports
    });
  }

  private async cacheLog(level: string, message: string, meta: LogMetadata): Promise<void> {
    const cacheKey = `logs:${this.context}:${level}`;
    const logEntry = JSON.stringify({
      timestamp: meta.timestamp,
      message,
      ...meta
    });

    await redisConfig
      .multi()
      .lpush(cacheKey, logEntry)
      .ltrim(cacheKey, 0, 999) // Keep last 1000 logs
      .expire(cacheKey, 86400) // Expire after 24 hours
      .exec();
  }

  private formatMetadata(meta: Record<string, any> = {}): LogMetadata {
    return {
      ...this.defaultContext,
      timestamp: new Date().toISOString(),
      context: this.context,
      ...meta
    };
  }

  async info(message: string, meta: Record<string, any> = {}): Promise<void> {
    const formattedMeta = this.formatMetadata(meta);
    this.logger.info(message, formattedMeta);
    await this.cacheLog('info', message, formattedMeta);
    metrics.increment('logger.info', { context: this.context });
  }

  async error(message: string, meta: Record<string, any> = {}): Promise<void> {
    const formattedMeta = this.formatMetadata(meta);
    this.logger.error(message, formattedMeta);
    await this.cacheLog('error', message, formattedMeta);
    metrics.increment('logger.error', { context: this.context });

    if (meta.error && process.env.SENTRY_DSN) {
      Sentry.withScope(scope => {
        scope.setExtras(formattedMeta);
        Sentry.captureException(meta.error);
      });
    }
  }

  async warn(message: string, meta: Record<string, any> = {}): Promise<void> {
    const formattedMeta = this.formatMetadata(meta);
    this.logger.warn(message, formattedMeta);
    await this.cacheLog('warn', message, formattedMeta);
    metrics.increment('logger.warn', { context: this.context });
  }

  async debug(message: string, meta: Record<string, any> = {}): Promise<void> {
    const formattedMeta = this.formatMetadata(meta);
    this.logger.debug(message, formattedMeta);
    await this.cacheLog('debug', message, formattedMeta);
    metrics.increment('logger.debug', { context: this.context });
  }

  async verbose(message: string, meta: Record<string, any> = {}): Promise<void> {
    const formattedMeta = this.formatMetadata(meta);
    this.logger.verbose(message, formattedMeta);
    await this.cacheLog('verbose', message, formattedMeta);
    metrics.increment('logger.verbose', { context: this.context });
  }

  async http(message: string, meta: Record<string, any> = {}): Promise<void> {
    const formattedMeta = this.formatMetadata(meta);
    this.logger.http(message, formattedMeta);
    await this.cacheLog('http', message, formattedMeta);
    metrics.increment('logger.http', { context: this.context });
  }

  async profile(name: string, meta: Record<string, any> = {}): Promise<() => Promise<void>> {
    const start = performance.now();
    const profileMeta = this.formatMetadata(meta);

    return async () => {
      const duration = performance.now() - start;
      profileMeta.duration = duration;
      
      this.logger.info(`Profile ${name} completed`, profileMeta);
      metrics.timing('logger.profile.duration', duration, { 
        name,
        context: this.context 
      });
    };
  }

  async flush(): Promise<void> {
    const flushPromises: Promise<any>[] = [];

    // Flush Winston transports
    this.logger.transports.forEach((transport: any) => {
      if (typeof transport.flush === 'function') {
        flushPromises.push(
          new Promise((resolve) => transport.flush(resolve))
        );
      }
    });

    // Flush Sentry events
    if (process.env.SENTRY_DSN) {
      flushPromises.push(Sentry.flush(2000));
    }

    // Flush Logtail
    if (this.logtail) {
      flushPromises.push(this.logtail.flush());
    }

    await Promise.all(flushPromises);
  }

  getLoggedMessages(
    level: string,
    limit: number = 100
  ): Promise<Array<{ timestamp: string; message: string; metadata: LogMetadata }>> {
    const cacheKey = `logs:${this.context}:${level}`;
    return redisConfig
      .lrange(cacheKey, 0, limit - 1)
      .then(logs => logs.map(log => JSON.parse(log)));
  }
}
