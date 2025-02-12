import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { validateApiKey } from './middleware/validateApiKey';
import config from './config/config';
import routes from './routes';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: config.app.corsOrigin,
    credentials: true
}));

// Rate limiting
app.use(rateLimit({
    windowMs: config.security.rateLimitWindow,
    max: config.security.maxRequests,
    message: { error: 'Too many requests, please try again later.' }
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// Logging
app.use(requestLogger);

// API key validation for protected routes
app.use('/api', validateApiKey);

// API routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version
    });
});

// Error handling
app.use(errorHandler);

// Graceful shutdown handling
const shutdownHandler = async (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
    
    // Close any active connections or resources
    try {
        // Add cleanup logic here
        console.log('Cleanup completed.');
        process.exit(0);
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
process.on('SIGINT', () => shutdownHandler('SIGINT'));

// Unhandled error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

export default app;
