import winston from 'winston';
import { SeqTransport } from '@datalust/winston-seq';

const logLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

export class Logger {
  private logger: winston.Logger;
  private context: string;

  constructor(context: string) {
    this.context = context;
    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
        winston.format.json()
      ),
      defaultMeta: { service: 'solsynthai', context },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        new SeqTransport({
          serverUrl: process.env.SEQ_SERVER_URL,
          apiKey: process.env.SEQ_API_KEY,
          onError: (e => {
            console.error('Seq logging error:', e);
          }),
        }),
      ],
    });
  }

  info(message: string, meta: Record<string, any> = {}): void {
    this.logger.info(message, { ...meta, context: this.context });
  }

  error(message: string, meta: Record<string, any> = {}): void {
    this.logger.error(message, { ...meta, context: this.context });
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    this.logger.warn(message, { ...meta, context: this.context });
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    this.logger.debug(message, { ...meta, context: this.context });
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.logger.transports.map((t) => 
        new Promise((resolve) => t.on('finish', resolve))
      )
    );
  }
}
