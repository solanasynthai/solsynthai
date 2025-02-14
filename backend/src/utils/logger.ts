import winston from 'winston'
import { Format } from 'logform'
import DailyRotateFile from 'winston-daily-rotate-file'
import config from '../config/config'

// Custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
}

// Log level colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
}

// Set colors for winston
winston.addColors(colors)

// Custom log format
const customFormat: Format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata(),
  winston.format.printf(({ timestamp, level, message, metadata, stack }) => {
    const metaString = metadata && Object.keys(metadata).length > 0 
      ? JSON.stringify(metadata, null, 2)
      : ''
    const stackString = stack ? `\n${stack}` : ''
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString} ${stackString}`
  })
)

// Console transport format
const consoleFormat: Format = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, metadata }) => {
    const metaString = metadata && Object.keys(metadata).length > 0 
      ? JSON.stringify(metadata, null, 2)
      : ''
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`
  })
)

// File rotation transport
const fileRotateTransport = new DailyRotateFile({
  filename: 'logs/solsynthai-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m',
  format: customFormat,
  level: config.monitoring.logLevel,
})

// Create the logger
const logger = winston.createLogger({
  level: config.monitoring.logLevel || 'info',
  levels,
  transports: [
    // Console logging
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    }),
    // Rotating file logging
    fileRotateTransport,
  ],
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/exceptions.log',
      format: customFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/rejections.log',
      format: customFormat,
    }),
  ],
})

// Custom error handler
logger.on('error', (error) => {
  console.error('Logger error:', error)
})

// Capture unhandled errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise })
})

// Helper functions for structured logging
export const logError = (message: string, error: Error, metadata: object = {}) => {
  logger.error(message, {
    ...metadata,
    error: {
      message: error.message,
      name: error.name,
      stack: error.stack,
    },
  })
}

export const logPerformance = (
  operation: string,
  durationMs: number,
  metadata: object = {}
) => {
  logger.info(`Performance: ${operation}`, {
    ...metadata,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
  })
}

export const logSecurity = (
  event: string,
  level: 'info' | 'warn' | 'error',
  metadata: object = {}
) => {
  logger[level](`Security: ${event}`, {
    ...metadata,
    timestamp: new Date().toISOString(),
  })
}

export const logTransaction = (
  type: string,
  status: 'start' | 'success' | 'failure',
  metadata: object = {}
) => {
  logger.info(`Transaction ${type}: ${status}`, {
    ...metadata,
    timestamp: new Date().toISOString(),
  })
}

// Create a child logger with additional context
export const createChildLogger = (context: string, metadata: object = {}) => {
  return logger.child({
    context,
    ...metadata,
  })
}

// Export the main logger and helper functions
export { logger }

// Export types for better TypeScript support
export type Logger = typeof logger
export type LogLevel = keyof typeof levels
