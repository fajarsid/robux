# Deployment

**Status:** Phase 1 implemented and verified locally for both the development and production overrides (see IMPLEMENTATION_PLAN.md §11). Backups (§8), Authenticated Origin Pulls and real Cloudflare certificates are Phase 18.
**Decision record:** ADR-002.

> This project uses a Docker-first deployment architecture. Docker Compose manages application services and their lifecycle. Nginx acts as the reverse proxy/edge gateway. PM2 is intentionally not used because application process lifecycle is managed by Docker.

---

## 1. Production model

```text
Cloudflare (DNS, proxy, WAF, TLS to origin: Full strict)
     │
     ▼
VPS (Linux, Docker Engine + Compose plugin only; no Node.js, no PM2 on the host)
     │
     ▼
Docker Compose project
 ├── nginx       :80/:443 published   reverse proxy / edge gateway
 ├── frontend    :3000 internal       Next.js production server (standalone)
 ├── api         :4000 internal       NestJS HTTP API
 ├── worker      internal             BullMQ consumers (scalable)
 ├── scheduler   internal             repeatable-job registration
 ├── postgres    :5432 internal only  never published
 ├── redis       :6379 internal only  never published
 └── migrate     one-shot             prisma migrate deploy, runs before api/worker/scheduler
```

No application process runs directly on the host. No hybrid host/container runtime.

## 2. Routing

| Host            | Upstream         | Notes |
|-----------------|------------------|-------|
| `app.<domain>`  | `frontend:3000`  | Storefront, account, admin UI. |
| `app.<domain>/api/*` | `api:4000` | Browser API calls, same origin as the page (ADR-008). `/healthz` (frontend container probe) denied. |
| `api.<domain>`  | `api:4000`       | `/api/v1/**` including `/api/v1/webhooks/*`, plus `/health` and `/health/live`. `/health/ready` and `/metrics` denied at Nginx. |
| anything else   | 444 / redirect   | Default server drops unknown hosts. |

Nginx responsibilities: TLS termination with a Cloudflare Origin Certificate, HTTP→HTTPS redirect, Authenticated Origin Pulls (mTLS from Cloudflare), real client IP from `CF-Connecting-IP` (trusted only from Cloudflare ranges), security headers, `client_max_body_size` (small; 1 MB default, webhooks sized to gateway needs), `limit_req` zones (stricter on `/api/v1/auth`, `/api/v1/orders`, `/api/v1/roblox/resolve`), SSE/WebSocket proxy settings (`proxy_buffering off`, upgrade headers) for the order monitor, `X-Request-Id` generation/forwarding, JSON access logs.

## 3. Environment separation

Development and production are separate Compose projects, set by the `name:` in each override file:

| Override | Project | Containers | Volumes |
|----------|---------|------------|---------|
| `docker-compose.dev.yml` | `robux-dev` | `robux-dev-*` | `robux-dev_pgdata`, `robux-dev_redisdata` |
| `docker-compose.prod.yml` | `robux-prod` | `robux-prod-*` | `robux-prod_pgdata`, `robux-prod_redisdata` |

Each project also has its own networks, so a development container cannot reach the production database even when both stacks run on one machine (verified). Do not set `COMPOSE_PROJECT_NAME` or pass `-p` for these files: that would override the separation. The development seed and dev accounts live only in `robux-dev_pgdata`; the production API refuses to start if they ever appear in its database.

Migration note (2026-10-05): the earlier shared volumes `robux_pgdata` and `robux_redisdata` were copied into the `robux-dev_*` volumes (data preserved) and left untouched as a backup. They are no longer mounted by anything and can be removed with `docker volume rm robux_pgdata robux_redisdata` once the development data has been checked.

## 3a. Networks

| Network  | internal | Members |
|----------|----------|---------|
| `edge`   | no       | nginx |
| `app`    | yes      | nginx, frontend, api |
| `data`   | yes      | api, worker, scheduler, migrate, postgres, redis |
| `egress` | no       | api, worker, scheduler |

Docker-published ports bypass host firewalls like UFW (Docker writes its own iptables rules). The real control for Postgres/Redis is "not published". The host firewall still restricts 80/443 to Cloudflare IP ranges and SSH to known addresses.

## 4. Service lifecycle

- `restart: unless-stopped` for every long-running service in `docker-compose.prod.yml`; `migrate` is `restart: "no"`.
- Startup order by health: `postgres`/`redis` healthy → `migrate` completed successfully → `api`, `worker`, `scheduler` → `frontend` (after `api` healthy) → `nginx`.
- Graceful shutdown: `tini` as PID 1; `stop_grace_period: 30s` for `worker`, 15s for others. Workers stop taking new jobs and let in-flight ones finish within `WORKER_SHUTDOWN_TIMEOUT_MS` (default 25 s); a job cut off at the timeout is re-delivered by BullMQ stalled-job recovery, and job state in PostgreSQL decides what is safe (ADR-004).
- Queue settings (optional, defaults shown): `QUEUE_PREFIX=bull`, `WORKER_SHUTDOWN_TIMEOUT_MS=25000`. Each environment uses its own Redis, so dev and prod never consume each other's jobs.
- Compose does not restart `unhealthy` containers by itself; only process exit triggers `restart:`. Fatal errors exit non-zero. `unhealthy` status must be alerted on (Phase 15).
- Logging: `json-file` driver with `max-size: 10m`, `max-file: 5` (or the `local` driver).
- Resource limits (`deploy.resources.limits` / `mem_limit`, `cpus`) set per service after measurement; initial guesses documented in `docker-compose.prod.yml`.

## 5. Configuration and secrets

- `.env.example` documents every variable. Real values are never committed.
- Non-secret config: env file on the host (`/opt/robux/.env`, mode `0600`, owner root).
- Payments (non-secret, Phase 6, docs/integrations/duitku.md): `PAYMENT_GATEWAY=none|duitku` (default `none`: payment intake off, no simulated gateway), `DUITKU_ENVIRONMENT=sandbox|production`, `DUITKU_CALLBACK_URL` (`https://api.<domain>/api/v1/webhooks/payments/duitku`), `DUITKU_RETURN_URL` (`https://app.<domain>/…`, the storefront return page), `DUITKU_PAYMENT_METHODS` (codes active in the Duitku project), optional `DUITKU_CALLBACK_ALLOWED_IPS` (Duitku's published callback IPs) and `DUITKU_REQUEST_TIMEOUT_MS` (default 15000). The API refuses to start with `duitku` and a missing key, method list or URL, and requires https URLs in production. The callback reaches the API through the `api.<domain>` host; Duitku requires port 80 or 443 and HTTP 200.
- `TRUSTED_ORIGINS` (non-secret): the exact browser origin(s), e.g. `https://app.<domain>`. Used for CSRF origin checks and CORS; wildcards are refused at startup.
- Secrets (DB password, Redis password, `csrf_secret`, `totp_encryption_key` (64 hex chars), `idempotency_encryption_key` (64 hex chars, api only, Phase 5), `duitku_merchant_code` and `duitku_api_key` (api only, Phase 6, values from the Duitku dashboard; `generate-secrets.sh` creates empty placeholders so Compose can mount them while payments are off), provider credentials, notification tokens): Compose `secrets:` mounted as files under `/run/secrets/*`, read by the config loader. Never in images, build args, or committed Compose files.

## 6. Commands (available from Phase 1)

Development (Windows/macOS/Linux with Docker Desktop or Engine):

```bash
cp .env.example .env                  # non-secret config
sh scripts/generate-secrets.sh        # secrets/postgres_password.txt, secrets/redis_password.txt
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -a        # all healthy, migrate exited 0
curl -H "Host: app.localhost" http://127.0.0.1:8088/                         # Next.js via Nginx
curl -H "Host: api.localhost" http://127.0.0.1:8088/health/live              # NestJS via Nginx
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api node dist/seed/run-seed.js  # dev data, idempotent
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart worker # API unaffected
docker compose -f docker-compose.yml -f docker-compose.dev.yml down          # keep volumes
```

Production stack locally (verification only; self-signed cert):

```bash
sh scripts/generate-dev-cert.sh       # secrets/origin_cert.pem, secrets/origin_key.pem
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
curl -k --resolve api.localhost:443:127.0.0.1 https://api.localhost/health/live
```

Production (on the VPS, images built by CI and pulled by tag):

```bash
export IMAGE_TAG=<git-sha>
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d        # migrate runs first automatically
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps           # all healthy, migrate exited 0
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale worker=3
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart worker   # API unaffected
```

First staff account in a new environment (no default credentials exist; the password is printed once):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api \
  node dist/cli/create-staff-account.js --email <address> --role SUPER_ADMIN
```

The production API refuses to start if development accounts (`@dev.robux.test`) exist or any staff account uses the development password. Never run the development seed against a production database (it refuses `NODE_ENV=production` as well).

Rollback: set `IMAGE_TAG` to the previous tag and run `up -d`. Migrations are written expand/contract style so the previous image keeps working against the newer schema; destructive migrations are split across two releases.

Verification after deploy:

```bash
docker compose ... exec api node -e "fetch('http://localhost:4000/health/ready').then(r=>process.exit(r.ok?0:1))"
ss -tlnp                                  # only :80, :443 (and SSH) listening on public interfaces
curl -s  https://api.<domain>/health/live     # {"status":"ok"}
curl -sI https://api.<domain>/health/ready    # 404 from Nginx (internal only)
```

## 7. CI/CD

GitHub Actions: install → lint → typecheck → unit tests → integration tests (Testcontainers) → build → Docker build (+ trivy scan) → push images tagged with git SHA. Production deploy is a separate, manually approved workflow (GitHub Environments with required reviewers) that SSHes to the VPS and runs the production commands above. No automatic production deploys initially.

## 8. Backups (detailed and tested in Phase 18)

- Nightly `pg_dump -Fc` from a short-lived container on the `data` network, encrypted (age/gpg), shipped off-host (S3-compatible object storage). Retention proposal: 7 daily, 4 weekly, 6 monthly.
- WAL archiving (wal-g or pgBackRest) for point-in-time recovery once revenue justifies it.
- Redis: AOF persistence for queue continuity; not backed up as a source of truth (PostgreSQL + outbox can rebuild queue state).
- Restore procedure and a timed restore drill are required before backups are declared working.

## 8a. Queue operations

- The `worker` relays outbox events and consumes the `payment`, `order-processing`, `fulfillment` and `inventory-sync` queues; the `scheduler` only registers schedules. Scale workers with `--scale worker=N`: relays take disjoint batches (`SKIP LOCKED`) and every consumer is idempotent.
- A paid order moves to `QUEUED` about one second after payment confirmation. An order stuck in `PAID` means the worker is down or Redis is unreachable: check `docker compose ... ps worker`, then `outbox_events` rows with `published_at IS NULL` and their `last_error`. Events are delivered automatically once the worker and Redis are back; nothing has to be re-sent by hand.
- Failed jobs are kept 7 days with job id (= outbox event id), name, queue, attempts, failure reason and correlation id (`job.failed_permanently` log lines carry the same fields).
- Fulfillment (Phase 9, ADR-006) runs only when the worker has a provider. Development Compose sets `FULFILLMENT_PROVIDER=mock` (simulated, `MOCK_FULFILLMENT_SCENARIO` defaults to `SUCCESS`); production Compose sets `FULFILLMENT_PROVIDER=none`, so `QUEUED` orders wait with their `FULFILLMENT_REQUESTED` events unpublished until an authorized provider is configured, and are then delivered as a backlog. The mock is refused in production at startup.
- An order in `RETRYING`, `PROCESSING` or `FULFILLMENT_PENDING` normally moves within minutes. If its job is gone (failed after 5 runs with `BUSY`/`CONFLICT`, or Redis data loss), find the order's `FULFILLMENT_REQUESTED` event and clear its `published_at` so the relay delivers it again; the engine resumes from the database and verifies before sending anything. `RECONCILIATION_REQUIRED` orders need a person: check the provider for the attempt's client reference first.

## 9. Known limits

- Single VPS: no cross-host failover. Upgrade path: managed PostgreSQL → managed Redis → second app host behind Cloudflare load balancing.
- Cloudflare proxy timeouts (100 s on most plans) apply to long requests; SSE endpoints send heartbeats, and no request waits on fulfillment.
