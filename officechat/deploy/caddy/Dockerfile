# Production Caddy build with native rate limiting module
FROM caddy:2.9.1-builder-alpine AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2.9.1-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
