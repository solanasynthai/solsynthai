import dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';

dotenv.config();

export const config = {
    app: {
        port: parseInt(process.env.PORT || '4000', 10),
        env: process.env.NODE_ENV || 'development',
        apiVersion: process.env.API_VERSION || 'v1',
        corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000'
    },

    solana: {
        network: process.env.SOLANA_NETWORK || 'devnet',
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        wsUrl: process.env.SOLANA_WS_URL || 'wss://api.devnet.solana.com',
        commitment: 'confirmed' as const,
        programId: process.env.PROGRAM_ID || '',
        connection: null as Connection
    },

    security: {
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
        jwtSecret: process.env.JWT_SECRET || 'development-secret',
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d'
    },

    ai: {
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.AI_MODEL || 'gpt-4',
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2000', 10)
    },

    storage: {
        path: process.env.STORAGE_PATH || './data',
        maxSize: parseInt(process.env.STORAGE_MAX_SIZE || '1073741824', 10), // 1GB
        backupEnabled: process.env.STORAGE_BACKUP_ENABLED === 'true',
        backupInterval: parseInt(process.env.STORAGE_BACKUP_INTERVAL || '86400000', 10) // 24 hours
    },

    monitoring: {
        enabled: process.env.MONITORING_ENABLED === 'true',
        logLevel: process.env.LOG_LEVEL || 'info'
    }
};

// Initialize Solana connection
config.solana.connection = new Connection(
    config.solana.rpcUrl, 
    config.solana.commitment
);

// Validate required configuration
const validateConfig = () => {
    const required = [
        { key: 'PROGRAM_ID', value: config.solana.programId },
        { key: 'JWT_SECRET', value: config.security.jwtSecret },
        { key: 'OPENAI_API_KEY', value: config.ai.openaiApiKey }
    ];

    const missing = required
        .filter(item => !item.value)
        .map(item => item.key);

    if (missing.length > 0) {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
};

validateConfig();

export default config;
