FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @paadi/db db:generate
RUN pnpm --filter @paadi/contracts --filter @paadi/domain --filter @paadi/db build
RUN pnpm --filter @paadi/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
WORKDIR /app
CMD ["node", "apps/api/dist/main.js"]
