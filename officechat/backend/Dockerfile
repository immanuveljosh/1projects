# Multi-stage production Dockerfile for OfficeChat Go backend
# Stage 1: Build static binaries
FROM golang:1.24-alpine3.21 AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /src

# Leverage Docker layer caching for dependencies
ENV GOTOOLCHAIN=auto
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source tree
COPY . .

# Compile static Go binaries without cgo
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64

RUN go build -trimpath -ldflags="-w -s -extldflags '-static'" -o /out/officechat-api ./cmd/api && \
    go build -trimpath -ldflags="-w -s -extldflags '-static'" -o /out/officechat-migrate ./cmd/migrate && \
    go build -trimpath -ldflags="-w -s -extldflags '-static'" -o /out/healthcheck ./cmd/healthcheck

# Stage 2: Minimal distroless runtime (no shell, non-root user)
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

# Copy timezone and ca-certificates from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Copy compiled static binaries and migrations
COPY --from=builder --chown=65532:65532 /out/officechat-api /app/officechat-api
COPY --from=builder --chown=65532:65532 /out/officechat-migrate /app/officechat-migrate
COPY --from=builder --chown=65532:65532 /out/healthcheck /app/healthcheck
COPY --from=builder --chown=65532:65532 /src/migrations /app/migrations

# Run as non-root user (UID 65532 is distroless 'nonroot')
USER 65532:65532

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
    CMD ["/app/healthcheck", "http://127.0.0.1:8080/healthz"]

ENTRYPOINT ["/app/officechat-api"]
