# Build stage
FROM node:20-alpine as builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build application
RUN VITE_API_URL=https://api.solsynthai.com \
    VITE_SOLANA_NETWORK=mainnet-beta \
    VITE_ENABLE_ANALYTICS=true \
    VITE_SENTRY_DSN=${SENTRY_DSN} \
    yarn build

# Production stage
FROM nginx:1.25-alpine

# Install utilities and security updates
RUN apk add --no-cache \
    curl \
    tini \
    # Clean up
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nginx && \
    adduser -S nginx -u 1001 -G nginx

# Copy nginx configuration
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY nginx/compression.conf /etc/nginx/compression.conf

# Copy built assets
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# Copy health check script
COPY --chown=nginx:nginx ./scripts/healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh

# Environment variables
ENV NGINX_WORKER_PROCESSES=auto \
    NGINX_WORKER_CONNECTIONS=1024 \
    NGINX_KEEPALIVE_TIMEOUT=65 \
    NGINX_CLIENT_MAX_BODY_SIZE=10M \
    # Security
    SECURE_HEADERS=true \
    # Cache control
    CACHE_CONTROL_MAX_AGE=31536000

# Create required directories with proper permissions
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/run \
    && chmod -R 755 /var/cache/nginx /var/log/nginx /var/run

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD /healthcheck.sh

# Expose port
EXPOSE 80

# Switch to non-root user
USER nginx

# Use tini as init
ENTRYPOINT ["/sbin/tini", "--", "nginx", "-g", "daemon off;"]

# Labels
LABEL org.opencontainers.image.title="SolSynthAI Frontend" \
      org.opencontainers.image.description="Frontend application for SolSynthAI smart contract platform" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.authors="SolSynthAI Team <team@solsynthai.com>" \
      org.opencontainers.image.url="https://github.com/solanasynthai/solsynthai" \
      org.opencontainers.image.source="https://github.com/solanasynthai/solsynthai" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.created="2025-02-15T22:33:02Z" \
      org.opencontainers.image.vendor="SolSynthAI"

# Default nginx configuration for single-page application
RUN echo $'\n\
location / {\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    try_files $uri $uri/ /index.html;\n\
    \n\
    # Cache configuration\n\
    expires $CACHE_CONTROL_MAX_AGE;\n\
    add_header Cache-Control "public, no-transform";\n\
    \n\
    # Security headers\n\
    include /etc/nginx/security-headers.conf;\n\
    \n\
    # Enable compression\n\
    include /etc/nginx/compression.conf;\n\
}\n\
\n\
# Health check endpoint\n\
location /health {\n\
    access_log off;\n\
    return 200 "healthy\\n";\n\
}\n\
\n\
# Metrics endpoint for Prometheus\n\
location /metrics {\n\
    stub_status on;\n\
    access_log off;\n\
}\n' > /etc/nginx/conf.d/default.conf
