PNPM ?= pnpm

.DEFAULT_GOAL := help
.PHONY: help start setup install env packages infra infra-down db db-generate db-push db-migrate db-studio dev api worker web mobile mcp build check lint verify up up-logs down clean

help:
	@echo "Paadi — common commands"
	@echo ""
	@echo "  make start        From a clean checkout: install, infra, db, then run the backend"
	@echo "  make up           Start the whole backend in Docker (db, redis, api, worker)"
	@echo ""
	@echo "  make setup        Enable pnpm, install deps, create .env files"
	@echo "  make infra        Start Postgres and Redis (Docker), wait until ready"
	@echo "  make db           Generate the Prisma client and create the tables"
	@echo "  make dev          Run the API and the worker together (watch mode)"
	@echo "  make api          Run only the API (watch)"
	@echo "  make worker       Run only the worker (watch)"
	@echo "  make web          Run the Next.js web app"
	@echo "  make mobile       Run the Expo mobile app"
	@echo "  make mcp          Build the MCP server and open the Inspector"
	@echo "  make verify       Smoke-test the running API"
	@echo "  make down         Stop the Docker services"
	@echo "  make clean        Stop Docker services and remove build output"

start: setup packages infra db dev

setup:
	corepack enable
	$(PNPM) install
	$(MAKE) env

install:
	$(PNPM) install

packages:
	$(PNPM) exec turbo run build --filter=@paadi/contracts --filter=@paadi/domain --filter=@paadi/db --filter=@paadi/api-client

env:
	@test -f apps/api/.env || cp apps/api/.env.example apps/api/.env
	@test -f apps/web/.env || cp apps/web/.env.example apps/web/.env
	@test -f apps/mobile/.env || cp apps/mobile/.env.example apps/mobile/.env
	@test -f apps/mcp/.env || cp apps/mcp/.env.example apps/mcp/.env
	@test -f packages/db/.env || cp packages/db/.env.example packages/db/.env

infra:
	docker compose up -d --wait postgres redis

infra-down:
	docker compose stop postgres redis

db: db-generate db-push

db-generate:
	$(PNPM) --filter @paadi/db db:generate

db-push:
	$(PNPM) --filter @paadi/db db:push

db-migrate:
	$(PNPM) --filter @paadi/db db:migrate

db-studio:
	$(PNPM) --filter @paadi/db db:studio

dev: packages
	$(PNPM) --filter @paadi/api dev & \
	$(PNPM) --filter @paadi/api dev:worker & \
	wait

api: packages
	$(PNPM) --filter @paadi/api dev

worker: packages
	$(PNPM) --filter @paadi/api dev:worker

web:
	$(PNPM) --filter @paadi/web dev

mobile:
	$(PNPM) --filter @paadi/mobile dev

mcp:
	$(PNPM) --filter @paadi/mcp build
	$(PNPM) --filter @paadi/mcp inspect

build:
	$(PNPM) build

check:
	$(PNPM) check-types

lint:
	$(PNPM) lint

verify:
	curl -s http://localhost:3001/pots/demo && echo ""
	curl -s -X POST http://localhost:3001/webhooks/nomba -H "content-type: application/json" -d "{}" && echo ""

up:
	docker compose up --build -d

up-logs:
	docker compose up --build

down:
	docker compose down

clean:
	docker compose down -v
	rm -rf apps/*/dist apps/*/.next packages/*/dist .turbo
