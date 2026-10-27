# Multi-stage production Dockerfile for OfficeChat React web frontend
# Stage 1: Build static assets
FROM node:20-alpine3.21 AS builder

WORKDIR /app

# Install dependencies using lockfile
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy source tree and compile production bundle
COPY . .
RUN npm run build

# Stage 2: Hardened unprivileged Nginx web server
FROM nginxinc/nginx-unprivileged:1.27.4-alpine-slim

# Copy custom secure Nginx configuration
COPY --chown=101:101 nginx.conf /etc/nginx/nginx.conf

# Copy production web artifacts
COPY --from=builder --chown=101:101 /app/dist /usr/share/nginx/html

# Run as unprivileged nginx user (UID 101)
USER 101:101

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
    CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]

ENTRYPOINT ["nginx", "-g", "daemon off;"]
