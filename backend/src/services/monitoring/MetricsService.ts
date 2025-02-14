import client, { Registry, Gauge, Counter, Histogram } from 'prom-client'
import express from 'express'
import { logger, logError } from '../../utils/logger'
import config from '../../config/config'

interface MetricLabels {
  [key: string]: string | number
}

export class MetricsService {
  private static instance: MetricsService
  private registry: Registry
  private server?: express.Application
  private readonly metrics: Map<string, client.Metric<string>>

  private readonly DEFAULT_PERCENTILES = [0.01, 0.05, 0.5, 0.9, 0.95, 0.99]
  private readonly DEFAULT_BUCKETS = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
  ]

  private constructor() {
    this.registry = new Registry()
    this.metrics = new Map()

    // Register default metrics
    if (process.env.NODE_ENV === 'production') {
      this.registry.setDefaultLabels({
        app: 'solsynthai',
        env: process.env.NODE_ENV,
        version: process.env.APP_VERSION || '0.0.0'
      })
      client.collectDefaultMetrics({ register: this.registry })
    }

    this.initializeMetrics()
  }

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService()
    }
    return MetricsService.instance
  }

  public async startServer(): Promise<void> {
    if (!config.metrics.prometheusEnabled) return

    try {
      this.server = express()
      
      // Metrics endpoint
      this.server.get('/metrics', async (req, res) => {
        try {
          res.set('Content-Type', this.registry.contentType)
          res.end(await this.registry.metrics())
        } catch (error) {
          logError('Failed to serve metrics', error as Error)
          res.status(500).end()
        }
      })

      // Health check endpoint
      this.server.get('/health', (req, res) => {
        res.status(200).json({ status: 'healthy' })
      })

      this.server.listen(config.metrics.prometheusPort, () => {
        logger.info(`Metrics server started on port ${config.metrics.prometheusPort}`)
      })

    } catch (error) {
      logError('Failed to start metrics server', error as Error)
    }
  }

  public increment(name: string, labels: MetricLabels = {}): void {
    try {
      const counter = this.getOrCreateCounter(name)
      counter.inc(labels)
    } catch (error) {
      logError(`Failed to increment metric: ${name}`, error as Error)
    }
  }

  public decrement(name: string, labels: MetricLabels = {}): void {
    try {
      const counter = this.getOrCreateCounter(name)
      counter.dec(labels)
    } catch (error) {
      logError(`Failed to decrement metric: ${name}`, error as Error)
    }
  }

  public gauge(name: string, value: number, labels: MetricLabels = {}): void {
    try {
      const gauge = this.getOrCreateGauge(name)
      gauge.set(labels, value)
    } catch (error) {
      logError(`Failed to set gauge: ${name}`, error as Error)
    }
  }

  public histogram(name: string, value: number, labels: MetricLabels = {}): void {
    try {
      const histogram = this.getOrCreateHistogram(name)
      histogram.observe(labels, value)
    } catch (error) {
      logError(`Failed to observe histogram: ${name}`, error as Error)
    }
  }

  public async reset(): Promise<void> {
    try {
      this.metrics.clear()
      await this.registry.clear()
      this.initializeMetrics()
    } catch (error) {
      logError('Failed to reset metrics', error as Error)
    }
  }

  private initializeMetrics(): void {
    // System metrics
    this.createGauge('system_memory_usage', 'Memory usage in bytes')
    this.createGauge('system_cpu_usage', 'CPU usage percentage')
    this.createGauge('system_load_average', 'System load average')

    // Application metrics
    this.createCounter('http_requests_total', 'Total HTTP requests')
    this.createHistogram('http_request_duration', 'HTTP request duration')
    this.createGauge('active_connections', 'Number of active connections')

    // Business metrics
    this.createCounter('contract_generation_total', 'Total contract generations')
    this.createHistogram('contract_generation_duration', 'Contract generation duration')
    this.createGauge('contract_complexity_score', 'Contract complexity score')

    // Cache metrics
    this.createCounter('cache_hits_total', 'Total cache hits')
    this.createCounter('cache_misses_total', 'Total cache misses')
    this.createGauge('cache_size', 'Current cache size')

    // Database metrics
    this.createGauge('db_connections', 'Database connections')
    this.createHistogram('db_query_duration', 'Database query duration')
    this.createCounter('db_errors_total', 'Total database errors')

    // Security metrics
    this.createCounter('auth_failures_total', 'Total authentication failures')
    this.createCounter('rate_limit_exceeded_total', 'Rate limit exceeded count')
    this.createGauge('active_sessions', 'Number of active sessions')
  }

  private createCounter(name: string, help: string): Counter<string> {
    const counter = new Counter({
      name,
      help,
      registers: [this.registry]
    })
    this.metrics.set(name, counter)
    return counter
  }

  private createGauge(name: string, help: string): Gauge<string> {
    const gauge = new Gauge({
      name,
      help,
      registers: [this.registry]
    })
    this.metrics.set(name, gauge)
    return gauge
  }

  private createHistogram(name: string, help: string): Histogram<string> {
    const histogram = new Histogram({
      name,
      help,
      buckets: this.DEFAULT_BUCKETS,
      registers: [this.registry]
    })
    this.metrics.set(name, histogram)
    return histogram
  }

  private getOrCreateCounter(name: string): Counter<string> {
    const metric = this.metrics.get(name)
    if (metric instanceof Counter) {
      return metric
    }
    return this.createCounter(name, `Counter for ${name}`)
  }

  private getOrCreateGauge(name: string): Gauge<string> {
    const metric = this.metrics.get(name)
    if (metric instanceof Gauge) {
      return metric
    }
    return this.createGauge(name, `Gauge for ${name}`)
  }

  private getOrCreateHistogram(name: string): Histogram<string> {
    const metric = this.metrics.get(name)
    if (metric instanceof Histogram) {
      return metric
    }
    return this.createHistogram(name, `Histogram for ${name}`)
  }

  public async getMetrics(): Promise<string> {
    try {
      return await this.registry.metrics()
    } catch (error) {
      logError('Failed to get metrics', error as Error)
      return ''
    }
  }

  public async clearMetrics(): Promise<void> {
    try {
      await this.registry.clear()
    } catch (error) {
      logError('Failed to clear metrics', error as Error)
    }
  }
}

export default MetricsService
