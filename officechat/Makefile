.PHONY: all up down logs build migrate seed test tidy clean

all: up

up:
	docker compose up -d

down:
	docker compose down

down-v:
	docker compose down -v

logs:
	docker compose logs -f

logs-api:
	docker compose logs -f api

logs-web:
	docker compose logs -f web

build:
	docker compose build

test-backend:
	cd backend && go test -v -race ./...

test-web:
	cd web && npm test

tidy:
	cd backend && go mod tidy

dev-backend:
	cd backend && go run ./cmd/api

dev-web:
	cd web && npm run dev

generate-mobile-api:
	cd mobile && flutter pub get && dart run build_runner build --delete-conflicting-outputs

