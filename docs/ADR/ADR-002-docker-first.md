# ADR-002: Docker-first Development and Deployment (No PM2)

- **Status:** Accepted (revised 2026-10-05 after the Docker-first architecture correction)
- **Date:** 2026-10-05
- **Deciders:** Engineering, product owner (architecture correction)
- **Supersedes:** PRD §13 header line "Nginx + PM2 / Docker-ready" and PRD §63 "PM2 processes"
- **Related:** ADR-001, PRD §64, Master Build Prompt §4–§9, §45, `docs/DEPLOYMENT.md`

## Decision statement

> This project uses a Docker-first deployment architecture. Docker Compose manages application services and their lifecycle. Nginx acts as the reverse proxy/edge gateway. PM2 is intentionally not used because application process lifecycle is managed by Docker.

## Context

The PRD described production as "Nginx + PM2 / Docker-ready" and listed PM2 processes `web`, `api`, `worker`, `scheduler` (§63), while also requiring `docker compose up -d` to work (§64). The master build prompt and the later architecture correction both require Docker-first with no PM2.

Running both models would mean two process definitions, two ways of injecting configuration and two failure behaviours, which is the dev/prod drift PRD §64 asks us to avoid. A hybrid (some services on the host under PM2, others in Docker) is explicitly not wanted.

Repository state at the time of this decision: documentation only. No PM2 configuration, no `ecosystem.config.*`, no Dockerfiles, no Compose files and no host-run services exist, so nothing has to be removed.

## Decision

### 1. Process lifecycle

- Every long-running process runs in its own container. Docker Compose starts, supervises and restarts them (`restart: unless-stopped` in production).
- PM2 is not installed in any image and not used on the host. The host runs only Docker Engine, Compose and the OS.
- PRD §63 process list maps to Compose services: `web` → `frontend`, `api` → `api`, `worker` → `worker`, `scheduler` → `scheduler`.
- Scheduled work runs in the dedicated `scheduler` container (BullMQ job schedulers, idempotent upsert). No PM2 cron, no host cron for application jobs. (Host cron/systemd timer is used only for the database backup job described in DEPLOYMENT.md, which is infrastructure, not application logic.)

### 2. Services

| Service     | Image / command                       | Port (container) | Lifecycle |
|-------------|---------------------------------------|------------------|-----------|
| `nginx`     | nginxinc/nginx-unprivileged (1.28)     | 8080/8443 → host 80/443 | `unless-stopped` |
| `frontend`  | `app-web`, `node server.js` (Next.js standalone) | 3000 | `unless-stopped` |
| `api`       | `app-api`, `node dist/main.js`         | 4000 | `unless-stopped` |
| `worker`    | `app-api`, `node dist/worker.js`       | 4001 (health, container-local) | `unless-stopped`, scalable |
| `scheduler` | `app-api`, `node dist/scheduler.js`    | 4002 (health, container-local) | `unless-stopped` |
| `postgres`  | postgres (pinned major)                | 5432 (never published in prod) | `unless-stopped` |
| `redis`     | redis (pinned major)                   | 6379 (never published in prod) | `unless-stopped` |
| `migrate`   | `app-api`, `prisma migrate deploy`     | — | one-shot, `restart: "no"` |

`api`, `worker` and `scheduler` share one image built from one codebase (ADR-001) but are separate containers that can be restarted, deployed and scaled independently. The API only writes to PostgreSQL (state + outbox) and enqueues; it never executes fulfillment. Workers consume BullMQ jobs from Redis and call providers.

### 3. Nginx role

Reverse proxy / edge gateway only: TLS termination using Certbot-managed Let's Encrypt certificates, HTTP→HTTPS redirect, security headers, request body size limits, basic rate limiting (`limit_req`), WebSocket/SSE proxy support, access/error logs (JSON), optional trusted Cloudflare client-IP headers, and routing:

```text
app.<domain>  → frontend:3000
api.<domain>  → api:4000      (paths under /api/v1, plus /health and /health/live; /health/ready and /metrics denied)
```

Nginx never proxies to PostgreSQL or Redis and is not a process manager.

### 4. Networks

| Network  | `internal` | Members                                            | Purpose |
|----------|-----------|----------------------------------------------------|---------|
| `edge`   | no        | nginx                                              | Only network with published host ports (80/443). |
| `app`    | yes       | nginx, frontend, api                               | Nginx → frontend/api; frontend SSR → `http://api:4000`. |
| `data`   | yes       | api, worker, scheduler, migrate, postgres, redis   | Database and queue access. No route to the internet. |
| `egress` | no        | api, worker, scheduler                             | Outbound HTTPS to payment gateway, Roblox, fulfillment providers, Telegram/Discord/email. No published ports. |

PostgreSQL and Redis are attached only to `data` and are not published in any environment, development included (a port cannot be published from an `internal` network). Use `docker compose exec postgres psql` / `exec redis redis-cli` for local inspection.

### 5. Compose files

- `docker-compose.yml` — base: services, networks, volumes, health checks, `depends_on` with conditions.
- `docker-compose.dev.yml` — same images and topology as production; plain-HTTP Nginx published on `127.0.0.1:${NGINX_DEV_PORT}` (default 8088), `NODE_ENV=development`, no restart policy. Hot reload inside containers is not provided yet (see Consequences).
- `docker-compose.prod.yml` — immutable image tags, `restart: unless-stopped`, resource limits, log rotation, Compose `secrets:`, only Nginx publishes ports.

Readiness: every long-running service has a `healthcheck`; dependants use `condition: service_healthy`; `api`/`worker`/`scheduler` also depend on `migrate` with `condition: service_completed_successfully`. Applications still retry their own connections, because Compose ordering does not cover a dependency restarting later.

### 6. Dockerfiles

- Multi-stage: `deps` (frozen lockfile install, `pnpm install --frozen-lockfile`) → `build` → `runtime`.
- Runtime: Node 22 LTS slim base, production dependencies only (`pnpm deploy --prod` for the API; Next.js `output: "standalone"` for the frontend), `NODE_ENV=production`.
- Non-root user (`node`, uid 1000). No secrets in images or build args. `.dockerignore` excludes `.env*`, `.git`, `node_modules`, test artifacts, docs.
- PID 1: `tini` (or Compose `init: true`) so `SIGTERM` reaches Node; apps implement graceful shutdown (`app.enableShutdownHooks()`, BullMQ `worker.close()`, Prisma/Redis disconnect). `stop_grace_period` sized to the longest safe job abort (default 30 s for workers).
- `HEALTHCHECK` in Compose (not only in the Dockerfile) so dev and prod use the same probes; probes use `node -e` fetch scripts so `curl` is not needed in the runtime image.
- Docker Compose does not restart a container just because it is `unhealthy`; only process exit triggers the restart policy. Fatal errors exit non-zero. A hung-but-alive process shows as `unhealthy` and must be acted on by alerting (automatic remedy decided in Phase 15).
- Production never runs `next dev` or `nest start --watch`.

### 7. Observability without PM2

Structured JSON logs to stdout (collected by Docker's `json-file` driver with rotation, or `local`), request/correlation id propagated from HTTP into outbox events and job data, health and readiness endpoints for every app container, queue metrics and Prometheus endpoints on the internal network. Details in ARCHITECTURE.md §9.

## Consequences

**Positive**

- Identical topology in development, CI and production. CI builds the images that get deployed.
- Postgres/Redis isolation is structural (no network route), not just a firewall rule.
- Worker scaling is `docker compose up -d --scale worker=N`. Rollback is "deploy the previous image tag".
- One place to look for process status: `docker compose ps` / health status.

**Negative / accepted risks**

- Single-host Compose has no cross-host failover. Path forward: managed Postgres/Redis, then multiple app hosts. Not Kubernetes on day one.
- No hot reload in containers yet. Day-to-day coding uses `pnpm test` / `pnpm typecheck` on the host; the dev stack is rebuilt to see changes end to end. A bind-mount dev target can be added later if rebuild time becomes a problem (Docker Desktop bind mounts on Windows are slow).
- Browser API routing was revised by ADR-008 (Phase 3): browsers call `app.<domain>/api/*` (same origin, host-only `__Host-` cookie, no browser CORS); `api.<domain>` remains for webhooks and server-to-server traffic.

## Alternatives considered

- **PM2 on the host (or hybrid PM2 + Docker):** rejected by the product owner and the master prompt; weaker isolation, dev/prod drift, two supervisors.
- **PM2 inside containers:** rejected; duplicates Docker's supervision, hides crashes from Compose health/restart, complicates signal handling.
- **Kubernetes / Swarm:** not justified for one host and seven services.
