# Deployment

**Status:** Existing host Nginx terminates TLS with host Certbot-managed Let's Encrypt certificates. Robux Docker Nginx binds only to loopback.
**Decision record:** ADR-002.

> This project uses a Docker-first deployment architecture. Docker Compose manages application services and their lifecycle. Nginx acts as the reverse proxy/edge gateway. PM2 is intentionally not used because application process lifecycle is managed by Docker.

---

## 1. Production model

Internet / optional Cloudflare proxy
  -> Existing host Nginx :80/:443 (shared VPS edge, host Certbot TLS)
  -> 127.0.0.1:ROBUX_LOCAL_PORT
  -> Docker Compose Robux edge (Nginx :8080 internal, frontend :3000, API :4000,
     worker, scheduler, private PostgreSQL/Redis, one-shot migration)

The host Nginx remains the public edge for all existing VPS projects. Robux deployment adds only a marked vhost in the active sites-enabled or conf.d convention. It validates the full host config with nginx -t before a graceful systemctl reload nginx; it never stops, restarts, disables, or replaces host Nginx. Host Certbot stores certificates under /etc/letsencrypt; only host Nginx reads the private key. Docker Nginx is HTTP-only and bound to 127.0.0.1:ROBUX_LOCAL_PORT. PostgreSQL and Redis remain private.

## 2. Routing

| Host            | Upstream         | Notes |
|-----------------|------------------|-------|
| `APP_DOMAIN`  | `frontend:3000`  | Storefront, account, admin UI. |
| `APP_DOMAIN/api/*` | `api:4000` | Browser API calls and Telegram webhook, same origin as the Mini App (ADR-008). `/healthz` (frontend container probe) denied. |
| `API_DOMAIN`  | `api:4000`       | Dedicated API hostname for provider callbacks and health checks. `/health/ready` and `/metrics` denied at Nginx. |
| anything else   | 444 / redirect   | Default server drops unknown hosts. |

The Docker Nginx retains app/API routing, security headers, request limits, SSE/WebSocket proxy support, request IDs, and JSON access logs. Public TLS, HTTP-to-HTTPS redirect, and ACME HTTP-01 handling belong to host Nginx. No TLS key is stored in the repository or mounted into Docker.

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

Docker-published ports bypass host firewalls like UFW (Docker writes its own iptables rules). The real control for Postgres/Redis is "not published". Keep SSH restricted. If Cloudflare is enabled, allow its ranges to reach HTTPS; allow inbound TCP/80 for Let's Encrypt HTTP-01 validation and renewal (or use DNS-01 after configuring an authorized DNS plugin).

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
- Non-secret config: env file on the host (`/var/www/robux/.env`, mode `0600`, owner root).
- Payments (non-secret, Phase 6, docs/integrations/duitku.md): `PAYMENT_GATEWAY=none|duitku` (default `none`: payment intake off, no simulated gateway), `DUITKU_ENVIRONMENT=sandbox|production`, `DUITKU_CALLBACK_URL` (`https://api.<domain>/api/v1/webhooks/payments/duitku`), `DUITKU_RETURN_URL` (`https://app.<domain>/…`, the storefront return page), `DUITKU_PAYMENT_METHODS` (codes active in the Duitku project), optional `DUITKU_CALLBACK_ALLOWED_IPS` (Duitku's published callback IPs) and `DUITKU_REQUEST_TIMEOUT_MS` (default 15000). The API refuses to start with `duitku` and a missing key, method list or URL, and requires https URLs in production. The callback reaches the API through the `api.<domain>` host; Duitku requires port 80 or 443 and HTTP 200.
- `TRUSTED_ORIGINS` (non-secret): the exact browser origin(s), e.g. `https://app.<domain>`. Used for CSRF origin checks and CORS; wildcards are refused at startup.
- Secrets (DB password, Redis password, `csrf_secret`, `totp_encryption_key` (64 hex chars), `idempotency_encryption_key` (64 hex chars, api only, Phase 5), `duitku_merchant_code` and `duitku_api_key` (api only, Phase 6, values from the Duitku dashboard; `generate-secrets.sh` creates empty placeholders so Compose can mount them while payments are off), provider credentials, notification tokens): Compose `secrets:` mounted as files under `/run/secrets/*`, read by the config loader. Never in images, build args, or committed Compose files.

## 6. Commands

Run the production helper on the VPS:

chmod 0750 ./deploy.sh
sudo ./deploy.sh <immutable-release-tag>

The script requires an existing .env with the intended public APP_DOMAIN, API_DOMAIN, and CERTBOT_EMAIL; it stops with DOMAIN_REQUIRED rather than inventing a hostname. Configure DNS for each name and use the VPS's existing host Nginx and Certbot. The helper snapshots nginx -T, verifies host Nginx owns ports 80/443, selects a free loopback-only Robux port, starts the application, detects the established vhost include convention, and adds or updates only its marked Robux file. It verifies HTTP-01 routing, obtains a certificate with host Certbot when needed, tests nginx -t, and gracefully reloads host Nginx. It then verifies the existing renewal timer/dry-run, existing domains, Robux HTTPS/redirect/API/Mini App, and Telegram webhook. It never installs a second Nginx/Certbot stack, binds Docker to public ports, or enables payment/fulfillment. It does not pull source code.

Set DEPLOY_BUILD=false only when tagged images are published to the configured registry. The production override keeps FULFILLMENT_PROVIDER=none and payment intake disabled. Development and production operational/rollback commands continue below.

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
