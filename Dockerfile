# syntax=docker/dockerfile:1

# Keep this in sync with the Node version developed against locally and
# with "packageManager" in package.json (corepack reads that field to pick
# the exact pnpm version - no separate pin needed here).
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# ---------------------------------------------------------------------------
# deps: full install (incl. devDependencies) - needed to run the Nest build.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile TypeScript -> dist/
# ---------------------------------------------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm run build

# ---------------------------------------------------------------------------
# prod-deps: production-only dependencies for the smallest possible runtime
# node_modules (no @nestjs/cli, typescript, jest, etc.).
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# runner: final minimal image, non-root, only what's needed to run node.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER nestjs

# HTTP API (PORT) and the AVT110 raw TCP listener (TRACKER_TCP_PORT).
# Actual bound ports are controlled by env vars at runtime - see .env.example.
EXPOSE 3000 6001

CMD ["node", "dist/main.js"]
