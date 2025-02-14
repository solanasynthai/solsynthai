declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Application
      NODE_ENV: 'development' | 'production' | 'test'
      APP_VERSION: string
      APP_NAME: string
      APP_PORT: string
      API_PREFIX: string
      COOKIE_SECRET: string
      CORS_ORIGIN: string
      REQUEST_LIMIT: string
      RATE_LIMIT_WINDOW: string
      RATE_LIMIT_MAX_REQUESTS: string

      // Authentication
      JWT_SECRET: string
      JWT_EXPIRATION: string
      REFRESH_TOKEN_SECRET: string
      REFRESH_TOKEN_EXPIRATION: string
      PASSWORD_SALT_ROUNDS: string

      // Database
      DB_HOST: string
      DB_PORT: string
      DB_NAME: string
      DB_USER: string
      DB_PASSWORD: string
      DB_SSL: string
      DB_MAX_CONNECTIONS: string
      DB_IDLE_TIMEOUT: string
      DB_CONNECTION_TIMEOUT: string

      // Redis Cache
      REDIS_HOST: string
      REDIS_PORT: string
      REDIS_PASSWORD: string
      REDIS_DB: string
      REDIS_TLS: string
      REDIS_RECONNECT_ATTEMPTS: string
      REDIS_RECONNECT_DELAY: string

      // WebSocket
      WS_MAX_CONNECTIONS: string
      WS_PING_INTERVAL: string
      WS_TIMEOUT: string
      WS_MESSAGE_SIZE_LIMIT: string

      // AI Service
      AI_API_KEY: string
      AI_API_ENDPOINT: string
      AI_API_VERSION: string
      AI_REQUEST_TIMEOUT: string
      AI_MAX_TOKENS: string
      AI_TEMPERATURE: string

      // Solana
      SOLANA_RPC_URL: string
      SOLANA_NETWORK: 'mainnet-beta' | 'testnet' | 'devnet'
      SOLANA_WALLET_SECRET: string
      SOLANA_COMMITMENT: 'processed' | 'confirmed' | 'finalized'

      // Monitoring
      METRICS_ENABLED: string
      METRICS_PREFIX: string
      LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
      SENTRY_DSN: string
      SENTRY_ENVIRONMENT: string
      SENTRY_TRACES_SAMPLE_RATE: string

      // Security
      SECURITY_HEADERS_ENABLED: string
      CSP_ENABLED: string
      RATE_LIMITER_ENABLED: string
      MAX_REQUEST_SIZE: string
      SSL_KEY_PATH: string
      SSL_CERT_PATH: string
      IP_WHITELIST: string

      // File Storage
      STORAGE_TYPE: 'local' | 's3'
      S3_ACCESS_KEY: string
      S3_SECRET_KEY: string
      S3_BUCKET: string
      S3_REGION: string
      LOCAL_STORAGE_PATH: string

      // Contract Generation
      MAX_CONTRACT_SIZE: string
      GENERATION_TIMEOUT: string
      MAX_CONCURRENT_GENERATIONS: string
      COMPILATION_TIMEOUT: string
      ANALYSIS_TIMEOUT: string

      // Testing
      TEST_DB_HOST: string
      TEST_DB_PORT: string
      TEST_DB_NAME: string
      TEST_DB_USER: string
      TEST_DB_PASSWORD: string
      TEST_REDIS_HOST: string
      TEST_REDIS_PORT: string
    }
  }
}

export {}
