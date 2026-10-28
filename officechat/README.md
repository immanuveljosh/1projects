# OfficeChat 🏢💬

OfficeChat is a modern, full-stack, enterprise-grade office team-chat web application inspired by Slack, Flock, and Discord. It is engineered with a decoupled Go REST & WebSocket backend and a responsive modern web client.

---

## 🌟 Tech Stack

- **Backend**:
  - **Go 1.22+**: Chi router, net/http, standard library architecture
  - **PostgreSQL 16**: Relational schema, GIN index full-text search (`tsvector`), ACID transactions
  - **Redis 7**: Live presence tracking and distributed pub/sub event fanout
  - **gorilla/websocket**: Typed, bidirectional real-time event streaming
  - **JWT Authentication**: Short-lived access tokens (15m) + secure rotating refresh tokens (7d)
  - **MinIO**: S3-compatible local/cloud object storage with virus-scan hooks and 25 MB file limits
- **Frontend**:
  - **React 18 + TypeScript (Vite)**
  - **Tailwind CSS**: Modern design system, sleek dark & light theme modes
  - **Zustand**: Client state management
  - **TanStack Query (React Query)**: Optimistic UI updates, caching, cursor-pagination
  - **React Router & React Hook Form + Zod**: Typed routing & strict input validation
- **DevOps & Architecture**:
  - **Docker Compose**: Orchestrated `postgres`, `redis`, `minio`, `api`, and `web`
  - **OpenAPI 3.0**: Fully documented API contracts (`openapi.yaml`)

---

## 🚀 Quick Start (Docker Compose)

The easiest way to run the entire OfficeChat stack locally:

```bash
# 1. Clone repository and navigate to project folder
cd officechat

# 2. Copy the sample environment configuration
cp .env.example .env

# 3. Spin up all containers (Postgres, Redis, MinIO, API, Web)
docker compose up -d

# 4. Follow application logs
docker compose logs -f
```

### Access URLs
- **Web App**: [http://localhost:3000](http://localhost:3000)
- **API Server**: [http://localhost:8080](http://localhost:8080)
- **MinIO S3 Console**: [http://localhost:9001](http://localhost:9001) (`minioadmin` / `minioadmin`)

---

## 💻 Local Development (Bare Metal)

### Backend (Go)
```bash
cd backend

# Ensure Go 1.22+ is installed
go version

# Run tests
go test -v -race ./...

# Start API server locally
go run ./cmd/api
```

### Frontend (React + Vite)
```bash
cd web

# Install dependencies
npm install

# Start Vite dev server with hot module reload
npm run dev
```

---

## 📂 Project Structure

```text
/officechat
├── backend/
│   ├── cmd/
│   │   └── api/main.go            # HTTP & WebSocket server entry point
│   ├── internal/
│   │   ├── auth/                  # Register, login, refresh, profile logic
│   │   ├── tokens/                # JWT generation, token rotation & bcrypt
│   │   ├── workspace/             # Workspace & membership services
│   │   ├── channel/               # Channels, permissions & membership
│   │   ├── message/               # Messages, threads, reactions, pins
│   │   ├── ws/                    # WebSocket hub, connection pool, Redis pub/sub
│   │   ├── storage/               # MinIO S3 object storage client & scan hooks
│   │   ├── db/                    # PostgreSQL pool & migration runner
│   │   ├── config/                # Environment configuration loader
│   │   ├── middleware/            # JWT auth, rate limiter, CORS, recovery
│   │   ├── models/                # Typed domain models & DTOs
│   │   └── utils/                 # Standard JSON & error response helpers
│   ├── migrations/                # PostgreSQL schema migrations
│   ├── openapi.yaml               # OpenAPI 3.0 API specification
│   └── Dockerfile
├── web/
│   ├── src/
│   │   ├── api/                   # Axios / fetch clients
│   │   ├── components/            # Reusable UI design system elements
│   │   ├── features/              # Feature slices (chat, channels, auth, tasks)
│   │   ├── hooks/                 # Custom React hooks (WS, shortcuts, theme)
│   │   ├── store/                 # Zustand state stores
│   │   ├── pages/                 # Route pages
│   │   ├── types/                 # TypeScript interfaces
│   │   └── utils/                 # Formatters, markdown, helpers
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── docker-compose.yml             # Orchestration for all services
├── Makefile                       # Developer shortcuts
├── .env.example                   # Environment configuration template
└── README.md
```

---

## 🧪 Running Tests

```bash
# Backend unit tests
make test-backend

# Frontend unit tests
make test-web
```
