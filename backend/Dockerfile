# Build stage
FROM node:20-alpine as builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build TypeScript
RUN yarn build

# Remove development dependencies
RUN yarn install --frozen-lockfile --production=true

# Production stage
FROM node:20-alpine

# Install production dependencies
RUN apk add --no-cache \
    tini \
    curl \
    postgresql-client \
    # Required for node-gyp
    python3 \
    make \
    g++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy built assets from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

# Copy additional required files
COPY --chown=nodejs:nodejs ./scripts/healthcheck.sh /healthcheck.sh
COPY --chown=nodejs:nodejs ./scripts/docker-entrypoint.sh /docker-entrypoint.sh

# Make scripts executable
RUN chmod +x /healthcheck.sh /docker-entrypoint.sh

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    # Increase Node.js memory limit
    NODE_OPTIONS="--max-old-space-size=4096" \
    # Enable source maps in production
    SOURCE_MAP_SUPPORT=true \
    # Security headers
    SECURE_HEADERS=true \
    # Clustering
    CLUSTER_MODE=true \
    # Metrics
    METRICS_ENABLED=true \
    # Tracing
    TRACING_ENABLED=true

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD /healthcheck.sh

# Switch to non-root user
USER nodejs

# Use tini as init
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]

# Default command
CMD ["node", "dist/server.js"]

# Labels
LABEL org.opencontainers.image.title="SolSynthAI Backend" \
      org.opencontainers.image.description="Backend service for SolSynthAI smart contract platform" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.authors="SolSynthAI Team <team@solsynthai.com>" \
      org.opencontainers.image.url="https://github.com/solanasynthai/solsynthai" \
      org.opencontainers.image.source="https://github.com/solanasynthai/solsynthai" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.created="2025-02-15T22:32:12Z" \
      org.opencontainers.image.vendor="SolSynthAI"
