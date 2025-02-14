# ---- Base Node ----
FROM node:18-alpine AS base
LABEL maintainer="solanasynthai"
LABEL description="Smart contract generation and analysis platform"
LABEL version="1.0.0"

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl \
    git \
    # Add Rust for smart contract compilation
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && source $HOME/.cargo/env

# Set working directory
WORKDIR /app

# Add node user for security
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 -G nodejs

# ---- Dependencies ----
FROM base AS dependencies

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install production dependencies
RUN yarn install --frozen-lockfile --production \
    && cp -R node_modules prod_modules \
    && yarn install --frozen-lockfile

# ---- Build Backend ----
FROM dependencies AS build-backend

# Copy backend source
COPY backend/ ./backend/
COPY tsconfig*.json ./

# Build backend
RUN yarn workspace @solsynthai/backend build

# ---- Build Frontend ----
FROM dependencies AS build-frontend

# Copy frontend source
COPY frontend/ ./frontend/
COPY tsconfig*.json ./

# Set build arguments
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_ENVIRONMENT

# Build frontend
RUN yarn workspace @solsynthai/frontend build

# ---- Production Backend ----
FROM base AS production-backend

# Copy built backend and production dependencies
COPY --from=build-backend /app/backend/dist ./dist
COPY --from=dependencies /app/prod_modules ./node_modules

# Copy necessary files
COPY backend/package.json ./
COPY backend/.env.production ./.env
COPY backend/src/database ./database

# Set environment variables
ENV NODE_ENV=production \
    PORT=4000

# Set user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start backend
CMD ["node", "dist/app.js"]

# ---- Production Frontend ----
FROM nginx:1.25-alpine AS production-frontend

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built frontend assets
COPY --from=build-frontend /app/frontend/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Set environment variables
ENV NGINX_PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${NGINX_PORT}/health || exit 1

# Expose port
EXPOSE ${NGINX_PORT}

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

# ---- Security Scanning ----
FROM aquasec/trivy:latest AS security-scan
WORKDIR /scan

# Copy application files for scanning
COPY --from=production-backend /app ./backend
COPY --from=production-frontend /usr/share/nginx/html ./frontend

# Run security scan
RUN trivy filesystem --exit-code 1 --severity HIGH,CRITICAL .

# ---- Final Stage ----
# Use specific target during build:
# docker build --target production-backend -t solsynthai/backend:latest .
# docker build --target production-frontend -t solsynthai/frontend:latest .
