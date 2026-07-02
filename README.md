# Paadi

Paadi is a bill-splitting and settlement product built on the Nomba payment rails, created for the DevCareer × Nomba hackathon.

You create a "pot" for a bill, everyone pays their share through a personal Nomba Checkout link, and Paadi settles the bill for you — it either pays the actual biller (electricity, cable) and returns the token, or pays out the pooled funds to the organizer. Money lands in one Nomba balance and a double-entry ledger keeps track of whose share is whose, so nothing drifts and nobody gets chased.

## Why this shape

A pot creator is an app user, not a Nomba merchant, so collected money pools in our own Nomba balance and is paid out from there. The ledger is the source of truth that partitions that single balance across pots, participants, and fees. Every inbound payment is attributed deterministically (one Checkout link per split), verified against Nomba's signed webhooks, recorded as a balanced ledger entry, and confirmed by re-query before any value is released.

## Monorepo layout

```
apps/
  api      NestJS — the payment engine and background workers (HTTP + worker entrypoints)
  web      Next.js (App Router, PWA) — public payer pages and web surfaces
  mobile   Expo / React Native — the installable creator app
packages/
  domain          framework-free core: ledger, state machines, idempotency, outbox, money, ports
  contracts       shared Zod DTOs, enums and event types
  db              Prisma schema, generated client and PrismaService
  api-client      typed client used by web and mobile
  typescript-config   shared tsconfig presets
  eslint-config       shared lint config
```

Everything is TypeScript under one `@paadi/*` scope. The `api` runs as two processes from one image: `node dist/main` (HTTP) and `node dist/worker` (BullMQ). Queue producers live in `api/src/queue`; processors live in `api/src/workers` and only run in the worker process, so a heavy job never blocks an HTTP request.

## Prerequisites

- Node.js 20+
- pnpm 9+ (activated through Corepack — `make setup` does this)
- Docker (for Postgres and Redis)
- GNU Make (preinstalled on macOS and Linux; optional — every command has a raw equivalent below)

## Quick start

From a clean checkout, one command installs everything, starts Postgres + Redis, creates the tables, and runs the API + worker:

```bash
make start
```

In another terminal, smoke-test it:

```bash
make verify
# {"status":"not_implemented"}
# {"received":true}
```

Prefer it fully containerized? `make up` runs the whole backend — Postgres, Redis, API, and worker — in Docker.

To run the steps individually:

```bash
make setup     # enable pnpm, install deps, create .env files
make infra     # start Postgres + Redis, wait until ready
make db        # generate the Prisma client and create the tables
make dev       # run the API + worker together (watch mode)
```

Run `make` on its own to list every command.

## Run it end to end (without make)

The same flow as the Makefile, step by step.

### 1. Install and create env files

```bash
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env
```

The api reads `apps/api/.env`; the Prisma CLI reads `packages/db/.env`. Both default to the local Docker Postgres and Redis started below.

### 2. Start Postgres and Redis

```bash
docker compose up -d postgres redis
```

### 3. Create the database schema

```bash
pnpm --filter @paadi/db db:generate   # generate the Prisma client
pnpm --filter @paadi/db db:push       # create the tables in Postgres
```

`db:push` is the fast path for local development. For tracked migrations use `pnpm --filter @paadi/db db:migrate --name <change>`.

### 4. Run the API and the worker

In two terminals:

```bash
pnpm --filter @paadi/api dev          # HTTP API on http://localhost:3001
pnpm --filter @paadi/api dev:worker   # BullMQ worker (background jobs)
```

### 5. Verify it is working

```bash
curl http://localhost:3001/pots/demo
# {"status":"not_implemented"}

curl -X POST http://localhost:3001/webhooks/nomba -H "content-type: application/json" -d "{}"
# {"received":true}
```

The endpoints are stubs — a response means the engine booted, Postgres and Redis connected, and routing works.

### 6. Run the frontends (owned by the frontend team)

```bash
cp apps/web/.env.example apps/web/.env
pnpm --filter @paadi/web dev          # web on http://localhost:3000

cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @paadi/mobile dev       # Expo dev server — scan the QR with Expo Go
```

## Run everything in Docker

```bash
cp apps/api/.env.example apps/api/.env
make up
```

`make up` (or `docker compose up --build`) starts Postgres, Redis, the API on `http://localhost:3001`, and the worker — the api and worker share one image and differ only by their start command. Run `pnpm --filter @paadi/db db:push` once against the running Postgres to create the tables. The web app deploys separately and is not in the compose file.

## Make targets

| Command | What it does |
| --- | --- |
| `make setup` | Enable pnpm, install dependencies, create `.env` files |
| `make infra` | Start Postgres + Redis (Docker) |
| `make db` | Generate the Prisma client and create the tables |
| `make dev` | Run the API and worker together (watch) |
| `make api` / `make worker` | Run one of them (watch) |
| `make web` / `make mobile` | Run a frontend |
| `make verify` | Smoke-test the running API |
| `make up` / `make down` | Start / stop all services in Docker |
| `make build` / `make check` / `make lint` | Build, type-check, or lint the workspace |
| `make clean` | Stop Docker services and remove build output |

## Per-service commands

| Target | Command |
| --- | --- |
| API (watch) | `pnpm --filter @paadi/api dev` |
| Worker (watch) | `pnpm --filter @paadi/api dev:worker` |
| API (built) | `pnpm --filter @paadi/api build && pnpm --filter @paadi/api start` |
| Web | `pnpm --filter @paadi/web dev` |
| Mobile | `pnpm --filter @paadi/mobile dev` |
| Generate Prisma client | `pnpm --filter @paadi/db db:generate` |
| Push schema to DB | `pnpm --filter @paadi/db db:push` |
| Create a migration | `pnpm --filter @paadi/db db:migrate --name <change>` |
| Open Prisma Studio | `pnpm --filter @paadi/db db:studio` |

## Workspace scripts

With Corepack enabled, the root scripts fan out across the workspace via Turborepo:

| Command | Description |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build everything |
| `pnpm check-types` | Type-check the whole workspace |
| `pnpm lint` | Lint the whole workspace |
| `pnpm db:generate` | Generate the Prisma client |
| `pnpm db:push` | Push the schema to the database |

## Environment variables

Backend variables live in `apps/api/.env`. **`apps/api/.env.example` is the source of truth — copy it as-is and it boots with no real keys** (`make setup`/`make start` do this for you). In local dev (`NODE_ENV=development`) the crypto secrets auto-derive when blank and the external providers default to safe stubs, so you need real credentials only when you want real delivery.

| Variable | Used for |
| --- | --- |
| `NODE_ENV` | `development` locally (stubs + secret auto-derive); `production` enforces real secrets + drivers |
| `DATABASE_URL` | Postgres connection |
| `REDIS_URL` | Redis connection (BullMQ + OTP/session state) |
| `API_PORT` | HTTP port (default 3001) |
| `NOMBA_BASE_URL` / `NOMBA_CLIENT_ID` / `NOMBA_CLIENT_SECRET` / `NOMBA_ACCOUNT_ID` | Nomba rails (banks, name-enquiry, payout) |
| `NOMBA_WEBHOOK_SIGNING_KEY` | Verifies inbound Nomba webhooks |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Sign access + refresh tokens (blank = dev fallback) |
| `OTP_PEPPER` | Keyed hash for OTP codes at rest in Redis |
| `PHONE_ENCRYPTION_KEY` / `PHONE_BLIND_INDEX_KEY` | Phone AES-256-GCM + keyed-HMAC lookup index |
| `ACCOUNT_NUMBER_ENCRYPTION_KEY` | Encrypts payout account numbers |
| `SENDCHAMP_API_KEY` / `SENDCHAMP_SENDER` / `SENDCHAMP_DRIVER` | OTP delivery; driver `console` (stub) or `sendchamp` (real) |
| `OTP_DEV_BYPASS_CODE` | Dev-only OTP bypass (default `000000`; clear to force real codes) |
| `DOJAH_APP_ID` / `DOJAH_API_KEY` / `DOJAH_WEBHOOK_SECRET` / `DOJAH_BASE_URL` / `DOJAH_DRIVER` | KYC; driver `mock` (stub) or `dojah` (real) |
| `GOOGLE_CLIENT_IDS` / `GOOGLE_DRIVER` | Google sign-in; driver `mock` (stub) or `google` (real) |
| `EXPO_ACCESS_TOKEN` | Push notifications (optional) |
| `NEXT_PUBLIC_API_URL` | API base for the web app (`apps/web/.env`) |
| `EXPO_PUBLIC_API_URL` | API base for the mobile app (`apps/mobile/.env`) |

The full FE-facing endpoint contract is in `apps/api/AUTH_API.md`, the typed `@paadi/api-client`, and the live OpenAPI at `/docs`.

## Troubleshooting

- **`Nest can't resolve dependencies of the JwtGuard (Reflector, ?)`** (or any `@paadi/*` import failing) — the shared packages aren't built. The packages compile to `dist/` (gitignored), so a fresh checkout must build them: run **`make packages`** (or `pnpm exec turbo run build --filter=@paadi/contracts --filter=@paadi/domain --filter=@paadi/db --filter=@paadi/api-client`). `make start` / `make dev` now do this for you.
- **`GOOGLE_DRIVER=google is required in production`** (or `DOJAH_DRIVER` / `SENDCHAMP_DRIVER`) — you're running with `NODE_ENV=production` but only stub drivers. For local dev use **`make dev`** (not a production build), and make sure `NODE_ENV` isn't exported in your shell: `echo $NODE_ENV` → `unset NODE_ENV` (a copied `.env` can't override a shell-exported variable). `make up` now runs the container in development mode.
- **Postgres `P1010` / "User was denied access"** — you have a local Postgres already bound to `5432`, shadowing the container. Add a gitignored `docker-compose.override.yml` with `services:\n  postgres:\n    ports:\n      - "5433:5432"`, then change `localhost:5432` → `localhost:5433` in `apps/api/.env` and `packages/db/.env`.
- **`pnpm: command not found`** — run `corepack enable` (it ships with Node).
- **Turborepo "cannot find package manager binary"** — pnpm is not on `PATH`; run `corepack enable`, or use the `--filter` commands above, which call pnpm directly.
- **API exits immediately or cannot connect** — make sure `make infra` is running and `apps/api/.env` has the matching `DATABASE_URL` / `REDIS_URL`.
- **Port already in use** — change `API_PORT` in `apps/api/.env`, or stop whatever is holding `5432` / `6379`.

## Documentation

Product and architecture documents live in `docs/` (git-ignored). The full Nomba API reference and the merged v3 architecture are there.
