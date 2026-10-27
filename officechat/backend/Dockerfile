# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/officechat-api ./cmd/api

# Final minimal runtime stage
FROM alpine:3.20

WORKDIR /app

RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /app/officechat-api /app/officechat-api
COPY --from=builder /app/migrations /app/migrations

EXPOSE 8080

CMD ["/app/officechat-api"]
