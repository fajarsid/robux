# syntax=docker/dockerfile:1.7
# One image for api, worker, scheduler and migrate (ADR-001). The process is chosen by the
# Compose `command`. Build context: repository root.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- base: pnpm via corepack, OpenSSL for Prisma engines -------------------------------
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# ---- deps: install from the lockfile only (deterministic, cached) ----------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@robux/api..."

# ---- build: compile shared + api, then produce a production-only bundle ----------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @robux/shared run build \
 && pnpm --filter @robux/api run build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @robux/api deploy --prod /out

# ---- runtime: production dependencies + compiled output, non-root ----------------------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

# Files stay root-owned and read-only for the `node` user that runs the process.
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/prisma.config.ts ./prisma.config.ts
COPY infra/docker/with-database-url.sh /usr/local/bin/with-database-url
RUN chmod 0755 /usr/local/bin/with-database-url

USER node
EXPOSE 4000
# PID 1 signal handling comes from Compose `init: true` (tini).
CMD ["node", "dist/main.js"]
