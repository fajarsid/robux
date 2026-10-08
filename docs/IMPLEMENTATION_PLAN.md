# Implementation Plan

**Date:** 2026-10-05
**Phase:** 0 (Repository Audit) complete. Implementation has not started.
**Inputs:** `docs/PRD.md` v1.0, Master Build Prompt, `ARCHITECTURE.md`, `SECURITY.md`, ADR-001, ADR-002.

---

## 1. Repository audit

| Item                 | Finding |
|----------------------|---------|
| Files                | `docs/PRD.md` only (3,104 lines, Indonesian/English). No source code, no config, no lockfile. |
| Version control      | **Not a git repository.** `git status` cannot run. Recommended first action of Phase 1: `git init`, `.gitignore`, secret scanning, first commit containing docs only. |
| Current architecture | None. Greenfield. |
| Current stack        | None in repo. Local toolchain: Node 22.18.0, npm 10.9.3, pnpm 10.17.1, Docker 29.6.1, Docker Compose v5.3.0, git 2.50.1 (Windows 11). |
| Existing functionality | None. |
| Technical debt       | None in code. Document-level debt: PRD/prompt conflicts in §3 below. |

Because the repository is empty, "preserve existing architecture" (PRD §89 rule 2) has nothing to preserve. The architecture in `ARCHITECTURE.md` becomes the baseline.

---

## 2. Missing functionality

Everything in PRD §95 and master prompt §58. Grouped by phase in §8.

---

## 3. PRD vs master prompt conflicts and resolutions

| # | Conflict | Resolution | Recorded in |
|---|----------|------------|-------------|
| C-01 | PRD §63 PM2 processes vs prompt "Docker-first, no PM2". Confirmed by the product owner's architecture correction (2026-10-05). | Docker Compose manages all application processes; Nginx is reverse proxy/edge gateway only; PM2 not used on host or in images; no hybrid host/container runtime. | ADR-002, DEPLOYMENT.md |
| C-12 | Architecture correction recommends subdomain routing (`app.` → frontend, `api.` → api) vs the earlier same-origin path routing draft. | Subdomain routing adopted. Requires CORS allow-list with credentials, CSRF token + Origin check, session cookie on parent domain. Path routing kept as documented fallback. | ADR-002 §3, SECURITY.md §3/§7 |
| C-02 | PRD §64 service `backend` vs prompt `api`; prompt adds `scheduler`. | Services: `frontend, api, worker, scheduler, postgres, redis, nginx` + one-shot `migrate`. | ADR-002 |
| C-03 | PRD §42/§65 JWT + refresh tokens vs prompt "secure cookies, session rotation". | Opaque server-side sessions with rotation; `SESSION_SECRET` replaces `JWT_*`. | SECURITY.md §3, ADR in Phase 3 |
| C-04 | PRD §46 `products.cost_price/selling_price` vs `product_prices` table in §44. | Versioned prices in `product_prices` only; snapshots on `order_items`. | ARCHITECTURE.md §5.2 |
| C-05 | PRD §12 `REMAINING_FULFILLMENT` state; prompt omits it. Prompt §26 adds `RECONCILIATION_REQUIRED`; §55 adds `VERIFYING`. | `REMAINING_FULFILLMENT` → `RETRYING` + `remaining_amount`. `RECONCILIATION_REQUIRED` is an order status. `VERIFYING` is an attempt status; `FULFILLMENT_PENDING` is its order-level face. | ARCHITECTURE.md §5.3 |
| C-06 | PRD §24 queues vs prompt §24 adds `reconciliation`. | Union of both. | ARCHITECTURE.md §6.8 |
| C-07 | PRD §22 "Redis distributed lock for critical sections" vs prompt §3.2 "PostgreSQL is authoritative". | Correctness from PostgreSQL (conditional updates, row locks, constraints). Redis locks only for efficiency (e.g. avoid two sync jobs hitting one provider). | ARCHITECTURE.md §6.5 |
| C-08 | PRD §87 has 8 phases; prompt §57 has 19. Prompt order puts Payment (6) before Redis/BullMQ (7), Fulfillment Engine (9) before Inventory (10), and Testing (17) last. | Follow prompt phase numbering, with three adjustments: (a) Redis container exists from Phase 1; Phase 6 writes outbox events which Phase 7 starts relaying; (b) Phase 9 includes single-source atomic reservation, because "never oversell" cannot be deferred; Phase 10 adds multi-source routing and sync; (c) tests are written in every phase; Phase 17 fills gaps and adds load/chaos tests. | This document §8 |
| C-09 | PRD §19 routing example vs PRD §20 rule 6 "minimise number of sources". | Resolved by D-08: fully satisfying plans, fewest sources, least leftover, priority only as tie-breaker. PRD §19 expected outputs are superseded. | ARCHITECTURE.md §6.5 |
| C-10 | PRD §39 public tracking at `/order/RBX-YYYYMMDD-NNNNN` vs privacy: sequential numbers are guessable. | Resolved by D-03: guest tracking via `/order/{guest_tracking_token}` (256-bit random, hashed at rest, rate-limited). Order number is displayed but never used as an access key. | SECURITY.md §2 |
| C-11 | PRD §45 users table has no `password_hash`; PRD §41 requires email/password for admin. | Add `password_hash` (nullable for future passwordless customers). | §5 below |

---

## 4. Risks

### R-01 — Fulfillment source legitimacy (critical, blocks production)

This is the biggest risk in the project and it is not technical.

- **Roblox's Terms of Use restrict buying, selling or transferring Robux outside Roblox's own authorized channels.** To our knowledge there is no public, official Roblox API that lets a third party credit Robux to an arbitrary user account.
- The common "gamepass" method (platform-controlled accounts buy a gamepass the customer created, so the customer receives Robux minus Roblox's 30% fee) is a peer-to-peer Robux transfer for real money. It is very likely outside Roblox's permitted use. Consequences can include termination of source accounts (inventory loss), reversal of Robux on customer accounts, and complaints from customers who are minors.
- An authorized route does exist for **digital Roblox gift cards / Robux codes** sold through Roblox-authorized distributors. That model delivers a redeemable code to the customer instead of crediting an account directly. Fulfillment semantics change (code delivery and secure display instead of "credit N Robux to user id"), but the order/payment/queue/reservation engine is the same.
- Payment gateways in Indonesia (and card networks) may also classify gray-market virtual currency as restricted, which can lead to merchant account termination and frozen settlements.

**Mitigation in this plan:**

1. Phases 1–10 and 13–18 are provider-agnostic and run fully against the mock provider (master prompt §15, §48). Nothing in them depends on how Robux is ultimately sourced.
2. No real provider adapter is written until the client names an authorized provider and supplies its documentation and contract. No endpoints are invented.
3. Phase 11 (Roblox) is limited to identity: username/user-id lookup and optional OAuth, via documented APIs only.
4. Phase 12 (Gamepass) builds the calculator and delayed-fulfillment state flow against the mock provider. Turning it on against real Roblox accounts requires the decision in D-01.
5. **The client should obtain legal review of the sourcing model before launch.** The engineering team cannot make that call.

### R-02 — Provider idempotency (high)

If the real provider cannot accept a client reference and cannot be queried by it, a timeout leaves the outcome unknowable and the order goes to manual reconciliation. Provider selection criteria: client-supplied idempotency reference, status query by reference, transaction history API, documented settle time, sandbox environment.

### R-03 — Duitku documentation and merchant approval (high, blocks Phase 6 real adapter)

D-02 selects Duitku. The adapter must be written against the official Duitku documentation (endpoints, fields, signature formula, callback encoding, status codes), saved to `docs/integrations/duitku.md` with source URL and date before coding. Nothing is written from memory. Needed from the team: Duitku sandbox merchant code + API key, confirmation that Duitku accepts this merchant category (virtual goods for a game platform), the enabled payment methods, and the callback/return URLs registered in the Duitku dashboard. **Update (Phase 6, 2026-10-05):** the contract is recorded in `docs/integrations/duitku.md` (source https://docs.duitku.com/api/en/, retrieved 2026-10-05) and `DuitkuPaymentGateway` implements it. No `MockGatewayAdapter` was built (the Phase 6 brief forbids simulated payment in the application); payments stay off (`PAYMENT_GATEWAY=none`) until the sandbox credentials and the open items in that file's §10 arrive.

### R-04 — Scope vs timeline (medium)

19 phases with full test coverage is a large build. Recommendation: define an MVP cut (D-11) — e.g. Phases 1–10 + minimal admin (orders, retry, refund, sources) + Phase 15/16 essentials — and defer charts, multi-channel notifications and gamepass.

### R-05 — Prisma limitations for locking (medium)

Prisma has no `SELECT … FOR UPDATE` builder and `$transaction` interactive transactions have timeouts. Reservation, claims and outbox relay use parameterised `$queryRaw`/`$executeRaw` inside interactive transactions, isolated in repository classes with integration tests against real PostgreSQL (Testcontainers). BigInt serialisation handled centrally.

### R-06 — Single host (medium)

One VPS is a single point of failure. Acceptable at launch with tested backups and a documented restore; managed Postgres is the first upgrade.

### R-07 — Windows development environment (low)

Bind-mount watchers on Docker Desktop can be slow; line-ending issues in shell scripts. Mitigation: `.gitattributes` (`* text=auto eol=lf`), polling watchers, documented host-run alternative.

### R-08 — Minors as customers (medium, legal/product)

Roblox's audience includes many minors. Payment, consent and refund policies may carry extra obligations. Client/legal decision.

---

## 5. Database (Phase 2)

The authoritative design is `docs/DATABASE.md`: 26 tables (the PRD's 18 plus 8 supporting tables), money and rounding rules, identifiers, status history, idempotency constraints, the locking strategy, delete behaviour and indexes.

Reconciliation of the PRD table list with this plan before implementation (2026-10-05):

| # | Finding | Resolution |
|---|---------|------------|
| C-13 | Fulfillment state transitions had no history table; the owner requires important fulfillment transitions to be auditable. | Added `fulfillment_attempt_status_history`. Fulfillment-order lifecycle transitions are covered by `order_status_history`. |
| C-14 | "Guest tracking token" was listed among supporting tables. | It is a column (`orders.tracking_token_hash`, unique), one per order. No table. |
| C-15 | Plan said the seed creates a SUPER_ADMIN with password and TOTP; password hashing and TOTP arrive in Phase 3. | Staff seed moves to Phase 3. Phase 2 seed: products, prices, mock sources, settings only. |
| C-16 | Plan put a separate app DB role (no UPDATE/DELETE on audit logs) in Phase 2. | Append-only enforced now by triggers on `audit_logs`, `product_prices`, both history tables and `source_balance_logs`. Separate DB roles move to Phase 16 (needs a second secret and grant management). |
| C-17 | `users.email` as `citext`. | Plain `text` with CHECK `email = lower(email)` and a unique index; avoids an extension for one column. |
| C-18 | `fulfillment_allocations.attempt_id` and `fulfillment_attempts.source_id` duplicated the same link. | One attempt executes exactly one allocation: `fulfillment_attempts.allocation_id UNIQUE`; source is reached through the allocation. |
| C-19 | Outbox "partial index on unpublished". | Regular `(published_at, created_at)` index; partial indexes are reserved for uniqueness rules (one PAID payment per order, one OPEN reconciliation case per order and kind). |

## 6. Required dependencies (to pin at Phase 1 scaffold; exact versions recorded in lockfile)

**Runtime / infra:** Node 22 LTS (matches local), PostgreSQL (current stable major), Redis (current stable major, BullMQ-compatible), Nginx stable.

**Backend (`apps/api`):** `@nestjs/core|common|platform-express|config|terminus|swagger|throttler`, `@prisma/client` + `prisma`, `bullmq`, `ioredis`, `nestjs-pino` + `pino`, `zod`, `decimal.js`, `argon2`, `otplib` (TOTP), `helmet`, `cookie-parser`, `prom-client`, `uuid` (v7), `@sentry/node` (optional).

**Frontend (`apps/web`):** `next`, `react`, `tailwindcss`, shadcn/ui (generated components + `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `lucide-react`), `framer-motion`, `zod`, `@tanstack/react-query` (client data/polling), `react-hook-form`.

**Shared:** `zod`, `decimal.js`.

**Tooling / tests:** `typescript` (strict), `eslint` + `typescript-eslint` + boundaries plugin, `prettier`, `jest` + `@swc/jest` (API unit/integration), `supertest`, `testcontainers` (Postgres/Redis), `vitest` + Testing Library (web), `@playwright/test` (E2E), `gitleaks`, `trivy` (CI), `husky` + `lint-staged`.

Each new dependency is justified in its PR; no dependency is added "just in case".

---

## 7. Docker architecture

Defined in ADR-002, ARCHITECTURE.md §3 and DEPLOYMENT.md. Summary:

- Docker Compose manages every application process (`frontend`, `api`, `worker`, `scheduler`) plus `nginx`, `postgres`, `redis` and a one-shot `migrate`. `restart: unless-stopped` in production. **No PM2**, no host-run Node processes, no hybrid.
- Nginx is reverse proxy / edge gateway only: `app.<domain>` → `frontend:3000`, `api.<domain>` → `api:4000`.
- Networks: `edge` (Docker Nginx bound to localhost in production), `app` (internal: nginx, frontend, api), `data` (internal: api, worker, scheduler, migrate, postgres, redis), `egress` (api, worker, scheduler). Host Nginx owns public 80/443; Postgres/Redis are never published in production.
- API never executes fulfillment; `worker` containers consume BullMQ jobs and are independently restartable/scalable; `scheduler` container owns repeatable jobs (no PM2 cron).
- Multi-stage, non-root, deterministic (`--frozen-lockfile`) images; Next.js standalone output; graceful shutdown with `tini`; health checks on every service; secrets injected at runtime.

---

## 8. Implementation phases

Each phase ends with the quality gate (master prompt §43): compiles, typecheck, lint, tests, build, migration, Docker build, Compose up, health checks, no secrets, no known critical security issue. Each phase is delivered as its own reviewable change set with a short report.

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **0 Audit** | This document, ARCHITECTURE, SECURITY, ADR-001/002. | Reviewed and decisions D-01…D-11 answered or explicitly deferred. ✅ docs delivered |
| **1 Docker + Foundation** | `git init`, `.gitignore`, `.gitattributes`, `.editorconfig`; pnpm monorepo; NestJS app with `main/worker/scheduler` entrypoints; Next.js app with design tokens and base layout; `packages/shared`; config validation (zod); pino logging + request id + redaction; global error filter with error codes; `/health`, `/health/live`, `/health/ready` (API) + container-local health and watchdog (worker, scheduler); multi-stage Dockerfiles + `.dockerignore`; Compose base/dev/prod with the four networks; Nginx reverse-proxy config (subdomain routing, headers, body limits, `limit_req`, JSON logs); `.env.example`; GitHub Actions CI (install, lint, typecheck, unit test, build, docker build); gitleaks. | `docker compose up` brings all services healthy; CI green; readiness fails correctly when Postgres or Redis is stopped; `docker compose restart worker` does not affect API; killing the worker process is recovered by Docker restart; `nmap`/`ss` on host shows only 80/443 published in prod config; no PM2 anywhere (`grep -ri pm2` clean outside docs). |
| **2 Database** | Prisma schema for §5 tables, migrations (generated + integrity constraints), append-only triggers, seed script, Testcontainers harness. Separate DB roles moved to Phase 16 (C-16). | Migration from empty DB works in Compose and CI; constraint tests (unique, CHECK) pass. |
| **3 Auth + AuthZ** | Register/login/logout, Argon2id, sessions + rotation, CSRF, TOTP 2FA + recovery codes for staff, login throttling/lockout, role/permission guards, `/api/v1/me`, audit for LOGIN/2FA_FAILURE; login/register/account pages; ADR-008 sessions. | Admin cannot reach admin APIs without 2FA; permission matrix tests per route; session rotation tests. |
| **4 Products + Pricing** | Product CRUD (admin), versioned pricing, `PriceQuote` service, availability (active + healthy + inventory; inventory stubbed until Phase 10), public `GET /api/v1/products`; product pages; audit PRICE_CHANGED/PRODUCT_CHANGED. | Price only from backend; unit tests for pricing/rounding/quantity limits. |
| **5 Order Engine** | Order state machine (table-driven) + conditional transitions; idempotent `POST /api/v1/orders`; order numbers; snapshots; status history; outbox writer; customer order history; cancellation rules; checkout UI (account → product → quantity → summary) with mock Roblox resolve. | Duplicate request returns same order; illegal transitions rejected; Scenario H passes. |
| **6 Payment** | `PaymentService` → `PaymentGateway` port → `DuitkuAdapter` (from official docs, `docs/integrations/duitku.md`) + `MockGatewayAdapter` (hosted page simulator, signed webhooks, status query); webhook endpoint with raw-body signature verification, event dedupe, amount/currency/reference checks, verify-by-fetch; PAID transition + outbox. Real gateway adapter once D-02 is decided. | Scenario B (duplicate webhook → one PAID, one fulfillment event); mismatch → RECONCILIATION_REQUIRED. |
| **7 Redis + BullMQ** | Queue module, queue definitions (§6.8), outbox relay with `SKIP LOCKED`, worker bootstrap, scheduler with idempotent job schedulers, custom backoff (5s/15s/30s/60s/5m), stalled-job handling, graceful shutdown, queue depth metrics. | Kill Redis mid-flow → no lost paid orders after recovery; kill worker mid-job → job re-delivered and handled safely. |
| **8 Mock Provider** | `FulfillmentProvider` interface; mock adapter with deterministic scenarios SUCCESS / TIMEOUT / TEMPORARY_FAILURE / PERMANENT_FAILURE / PARTIAL_FULFILLMENT (+ "succeeded but timed out"), configurable per source and per test; in-memory/DB-backed mock ledger so `verify` is truthful. | Adapter contract test suite (reused later for real adapters). |
| **9 Fulfillment Engine** | Claim, attempts, single-source atomic reservation, execute, verify loop, UNKNOWN handling, partial handling (remaining only), release on failure, retry policy, FULFILLED/FAILED_PERMANENTLY, cost snapshot, kill switch. | Scenarios A, C, D, F pass end-to-end with mock provider; no path executes twice for one allocation. |
| **10 Inventory + Smart Routing** | Routing function, multi-source reservation with ordered locks, ledger, balance sync (keeps reservations, UNKNOWN on error), health checks, low-balance alerts (outbox), OUT OF STOCK availability. | Scenarios E and G (concurrency test with parallel transactions on real Postgres) pass; ledger sums match balances. |
| **11 Roblox Integration** | `RobloxIdentityPort`; adapter on documented Roblox APIs (username → id, display name, avatar), caching, rate limiting; optional Roblox OAuth sign-in if D-05 chooses it. Requires reading official docs first. | Resolve flow works against real API in dev; mock adapter in tests; no credential fields anywhere. |
| **12 Gamepass / Delayed** | Gross-up calculator (`ceil(net / 0.70)`, fee rate configurable), gamepass order state flow, SLA display (5–7 days), detection job interface with mock. Real detection/purchase only after D-01. | Calculator unit tests; delayed flow E2E with mock. |
| **13 Admin Dashboard** | Metrics (revenue, COGS, profit, success rate, avg fulfillment time, balances), order monitor with filters + near-real-time updates, order detail timeline, actions (retry, cancel, refund, reprocess) with confirmation + reason + audit, product/pricing manager, sources/inventory screen, reconciliation queue, audit viewer. | Permission matrix enforced in UI and API; all actions audited. |
| **14 Notifications** | Channel adapters (Telegram, Discord, email via SMTP/provider, in-app), templates, per-event routing, retries, failure isolation. | Channel outage does not affect order flow (test). |
| **15 Observability** | Metrics from master prompt §41, Prometheus endpoint (internal), optional Prometheus/Grafana profile, Sentry with redaction, log field audit. | Dashboard shows queue depth, latency, error rates in a test run. |
| **16 Security Hardening** | Separate application DB role (no DDL, no TRUNCATE/UPDATE/DELETE on append-only tables; C-16); CSP enforce, headers, rate-limit tuning, anti-abuse signals, container hardening, dependency + image scanning, SECURITY.md checklist walk-through. | Checklist in SECURITY.md §12 completed with evidence. |
| **17 Testing** | Gap fill to cover master prompt §42 list; Playwright E2E for customer and admin critical paths (mobile viewport included); load test of checkout + webhook burst; chaos tests (Redis/Postgres/worker restarts). | All critical scenarios automated and green in CI. |
| **18 Production Readiness** | Prod Compose, Cloudflare (Full strict, origin cert, AOP, WAF rules for webhooks), host hardening, backups (nightly `pg_dump` + WAL archiving, off-host, encrypted) with **tested restore**, RUNBOOK, DEPLOYMENT, DATABASE, API docs, manual-approval deploy workflow. | Restore drill done and timed; runbook walkthrough; go/no-go review including R-01 sign-off. |

---

## 9. Decisions

| ID | Decision | Status | Affects |
|----|----------|--------|---------|
| D-01 | Fulfillment sourcing / authorized provider. | **Open.** R-01 is a hard architectural constraint: no unofficial Roblox fulfillment adapter, no credential harvesting or storage, no cookie/session theft, no auth or CAPTCHA bypass, no unauthorized browser automation, no undocumented/private API abuse. `MockFulfillmentProvider` behind `FulfillmentProvider` until an authorized provider and its contract exist. Does not block Phases 1–10. | Real adapter, production |
| D-02 | Payment gateway. | **Decided: Duitku** (first and primary), behind `PaymentGateway` port. Credentials via `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, `DUITKU_ENVIRONMENT`. Adapter from official docs only (R-03). | Phase 6 |
| D-03 | Guest checkout and tracking. | **Decided: guest checkout yes.** Guests receive order number + guest tracking token + tracking page `/order/{guest_tracking_token}`. Token random, non-sequential, hashed at rest, rate-limited, never exposes internal ids. | Phase 5 |
| D-04 | Customer authentication. | **Decided: optional accounts**, server-side sessions, no browser JWT. Admin auth separate; staff TOTP optional and enforced once enabled (changed from mandatory on 2026-10-05, owner decision). | Phase 3 |
| D-05 | Roblox identity: username lookup vs Roblox OAuth. | Open (default: documented username lookup). | Phase 11 |
| D-06 | Currency, tax, fees, rounding. | **Confirmed (2026-10-05):** IDR only, whole rupiah, half-up rounding once per stored amount; tax 0, fee 0, discount 0, so total = subtotal. The chain subtotal → discount → fee → tax → total stays in `quotePrice` with replaceable `PriceAdjustmentRules`, and orders store every step (`orders.tax` added in Phase 5). | Phase 4, 5 |
| D-07 | Refund execution. | Open. | Phase 13 |
| D-08 | Routing objective. | **Decided:** active+healthy → has balance → fully satisfying → fewest sources → least leftover → priority tie-break. Deterministic; reservation atomic before execution. | Phase 10 |
| D-09 | UI language. | **Decided: Bahasa Indonesia default** (customer and admin), i18n-ready structure (`next-intl`, message catalogs). No second language in Phase 1. | Phase 1+ |
| D-10 | Hosting, domain, Cloudflare plan, email provider. | Open. | Phase 14/18 |
| D-11 | MVP cut and timeline. | Open. | Planning |

---

## 10. Documents still to be created (per phase)

`API.md` (Phase 5+, generated from OpenAPI plus idempotency/error-code guide), `DATABASE.md` (created in Phase 2), `RUNBOOK.md` (Phase 1 skeleton, completed Phase 18). `DEPLOYMENT.md` exists as a target-state document from Phase 0 and becomes executable in Phase 1, ADR-003 PostgreSQL as source of truth (Phase 2), ADR-004 BullMQ + outbox (Phase 7), ADR-005 provider adapter pattern (Phase 8, created), ADR-006 idempotent fulfillment (Phase 9), ADR-007 inventory reservation strategy (Phase 10), ADR-008 sessions and same-origin browser API routing (created in Phase 3).

---

## 11. Phase 1 status (verified 2026-10-05)

Verified on Docker Desktop 29.6.1 / Compose v5.3.0 (Windows 11). Awaiting owner review; not committed.

| Exit criterion | Result |
|----------------|--------|
| `docker compose config` (dev and prod) | Pass |
| Development stack builds and runs | Pass |
| Production stack builds | Pass (`robux-api` 847 MB, `robux-web` 408 MB) |
| Production stack starts | Pass: 7 services healthy, `migrate` exited 0 (`No pending migrations to apply`) |
| Nginx | Pass: HTTP → HTTPS 301; TLS 1.2/1.3 with HTTP/2; unknown host rejected at TLS handshake |
| Next.js through Nginx | Pass: `https://app.<domain>/` 200, Indonesian homepage; `/api/healthz` 404 at the edge |
| NestJS through Nginx | Pass: `/health`, `/health/live` 200; `/health/ready`, `/metrics` 404 at the edge; error body `{code,message,requestId}` |
| PostgreSQL / Redis connectivity | Pass: authenticated readiness 200 from api, worker, scheduler; Redis rejects unauthenticated commands (`NOAUTH`), `FLUSHALL` disabled, AOF on, `noeviction` |
| PostgreSQL / Redis isolation | Pass: unreachable from `frontend` and `nginx` (ENETUNREACH); no published ports |
| Egress | Pass: only api, worker, scheduler reach the internet |
| Public ports | Pass: existing host Nginx owns public 80/443; production Docker Nginx binds only to loopback |
| Worker isolation | Pass: `restart worker` leaves api, frontend, postgres, redis, nginx, scheduler untouched; API and web returned 200 throughout |
| Crash recovery | Pass: SIGKILL of the worker process → Docker restarted it in ~8 s (`RestartCount` 1), healthy again |
| Readiness reflects dependencies | Pass (dev run): Redis or PostgreSQL stopped → 503; recovers to 200 |
| Graceful shutdown | Pass: SIGTERM → `worker.shutdown` logged, clean exit |
| Container hardening | Pass: non-root users (node / nginx / redis; postgres server as `postgres`), read-only root FS, `cap_drop: ALL`, `no-new-privileges`, tini init, memory limits, `unless-stopped`. Postgres keeps default capabilities and a writable root FS (its entrypoint needs them to initialise and drop privileges). |
| Secrets | Pass: no secret values in container env (file-mounted); gitleaks on committable files: no leaks |
| Logs | Pass: no errors, warnings, auth failures, migration errors or restart loops |
| No PM2 | Pass |
| Lint / format / typecheck / unit tests / build | Pass (16 API tests) |
| Structural review (ENGINEERING_STANDARDS §15) | Pass |
| CI | Workflow written; not run (no remote repository, by owner instruction) |

Fixes made during verification: duplicate `Strict-Transport-Security` header (Nginx now drops the upstream copy); `scripts/scan-secrets.sh` rewritten to scan committable files plus history (gitleaks `git` mode cannot run before the first commit, and `dir` mode flags git-ignored local secrets/build output by design); `next-env.d.ts` treated as generated (git- and prettier-ignored, produced by `next typegen` in `typecheck`).

---

## 12. Phase 2 status (verified 2026-10-05)

Awaiting owner review; not committed.

| Exit criterion | Result |
|----------------|--------|
| Prisma schema complete and reviewed | Pass: 26 tables in 9 domain files under `apps/api/prisma/schema/`; table list reconciled with the PRD first (§5, C-13…C-19) |
| Migrations execute | Pass: `20261005010000_init_schema` (generated) and `20261005010100_integrity_constraints` (CHECKs, append-only triggers); applied by Testcontainers and by the `migrate` container; rerun reports `No pending migrations to apply` |
| PostgreSQL starts cleanly through Docker | Pass |
| Seed deterministic | Pass: two runs produce identical data; balances changed after seeding are not reset; refuses `NODE_ENV=production` |
| Constraints | Pass: 57 CHECK constraints, unique and partial unique indexes, FK delete rules (RESTRICT except 5 documented exceptions) |
| Indexes | Pass: every index in DATABASE.md §11 present (asserted by test) |
| Pricing versioning | Pass: append-only `product_prices` with version numbers; order items keep price/cost snapshots and the exact version (Scenario H test) |
| Order identifiers | Pass: UUID v7 id, `RBX-YYYYMMDD-NNNNN` number (Jakarta date, concurrency-safe counter, 40 parallel allocations gap-free), 256-bit guest token stored as SHA-256 hash |
| Status history | Pass: `order_status_history` written atomically with conditional status update; stale or concurrent transitions record nothing; `fulfillment_attempt_status_history` for attempts |
| Idempotency constraints | Pass: order idempotency key, `idempotency_keys(scope,key)`, webhook `(source,event_key)`, gateway reference, one PAID payment per order, attempt client reference/allocation |
| Concurrency | Pass: two concurrent 700-Robux reservations on a 1,000 balance → exactly one succeeds; concurrent allocation settlement applies once; CHECK forbids negative balances |
| Transactional rollback | Pass: a failing statement rolls back order, items and history together |
| FK / delete behaviour reviewed | Pass: DATABASE.md §10, asserted by test |
| Database integration tests | Pass: 45 tests, 7 suites, real PostgreSQL 17, includes a `prisma migrate diff` drift check |
| Phase 1 regression | Pass: lint, format, typecheck, 23 unit tests, build, no-PM2 check |
| Docker production stack | Pass: rebuilt; all services healthy; web 200, `/health/live` 200, `/health/ready` blocked at edge; readiness 200 in api/worker/scheduler; no errors in logs |
| No secrets | Pass: gitleaks on committable files; test container password is a throwaway literal; seed has no users or credentials |
| No PM2 | Pass |
| Git | No commit, no push |

Design choices to note: Prisma `partialIndexes` preview feature for the two partial unique indexes (keeps them in the schema, avoids drift); generated enum constants allowed in `domain/` (ENGINEERING_STANDARDS §3.2); `OrderStatusTransitionRepository` and `OrderNumberAllocator` ports with Prisma implementations exist now because the identifier and history guarantees needed real code to test; the order state machine rules and the order creation use case remain Phase 5.

---

## 13. Phase 3 status (verified 2026-10-05)

Awaiting owner review; not committed. No schema change was needed: the Phase 2 identity tables were sufficient.

| Exit criterion | Result |
|----------------|--------|
| Customer authentication | Pass: register, login, logout, profile, change password (rotates this session, ends all others). Argon2id; generic errors for wrong password and unknown email; staff cannot use the customer login |
| Guest checkout | Pass: no route requires an account for guests; guest tracking works without a session. Checkout itself is Phase 5 |
| Server-side sessions | Pass: opaque token, SHA-256 at rest in PostgreSQL, `__Host-sid` HttpOnly/Secure/SameSite=Lax/host-only cookie (asserted), idle and absolute expiry |
| Session security | Pass: fixation (planted id never authenticated; attacker session revoked when victim logs in with it), rotation, rotated-token reuse revokes the family, logout invalidation, expiry, suspension |
| Admin authentication | Pass: separate staff login; password step grants nothing until 2FA |
| Admin 2FA | Pass: TOTP enrollment on first login, verification, wrong and replayed codes rejected, secret AES-256-GCM encrypted at rest, RFC 6238 vectors |
| Recovery codes | Pass: 10 codes shown once, Argon2id hashed, single use under concurrency, audited |
| Role-based authorization | Pass: permission matrix per role tested; escalation attempts (ADMIN changing roles, own-role change, promoting a customer) rejected; role change audited and target signed out |
| IDOR | Pass: customer A cannot read customer B or guest orders (404, indistinguishable from missing) |
| Guest tracking security | Pass: only public fields; same 404 for unknown, malformed and guessed tokens (order number, id, hash); 30/min/IP limit with Retry-After; `no-store`, `no-referrer` |
| Rate limiting | Pass: Redis `rl:` namespace, hashed emails, login/2FA/tracking limits verified in tests and through Nginx in production |
| CSRF / CORS | Pass: missing or foreign Origin rejected, Referer fallback, session-bound token required, foreign token rejected; CORS only for exact trusted origin |
| Passwords hashed | Pass: Argon2id for passwords and recovery codes; no plaintext in DB, logs or audit |
| No Roblox credentials | Pass: strict schemas reject extra credential fields; nothing stores or logs Roblox data; UI warns users never to enter a Roblox password |
| Phase 2 tests | Pass: 45 database tests unchanged |
| New tests | Pass: 49 unit tests (was 16; TOTP, permissions, cipher, stages, IP masking, config), 87 integration tests in 12 suites (42 new HTTP tests against the full app on PostgreSQL + Redis) |
| Docker production regression | Pass on a fresh isolated volume: all services healthy, migrations applied, staff created with the CLI, full password + TOTP enrollment over HTTPS through host Nginx, SSR admin page, isolation of PostgreSQL/Redis, only host Nginx owns public 80/443 and Robux Docker Nginx is loopback-only, worker restart leaves others untouched, no errors in logs, no secrets in container env. Against the dev-seeded volume the production API refuses to start (intended) |
| Gitleaks | Pass on committable files (three test-fixture literals it flagged were replaced with values generated per test run) |
| Documentation | Pass: ADR-008, SECURITY sections 3, 4 and 7, ARCHITECTURE, DEPLOYMENT, ENGINEERING_STANDARDS, CLAUDE.md, .env.example, secrets/README |
| No PM2, no commit, no push | Pass |

Design changes recorded: ADR-008 (same-origin browser API through Nginx and host-only `__Host-` cookie, replacing the parent-domain cookie plan); `TRUSTED_ORIGINS` replaces `CORS_ALLOWED_ORIGINS`; new secrets `csrf_secret`, `totp_encryption_key`; the frontend health route moved to `/healthz`; `configure-http-app.ts` holds the HTTP pipeline shared by `main.ts` and the tests.

Known limitations: registration cannot fully hide an existing email until email verification (Phase 14); no password reset until email delivery (Phase 14); TOTP enrollment shows the secret and an otpauth link but no QR code; rate limiting fails closed if Redis is down; three permission questions are open (SECURITY.md section 4).

---

## 14. Phase 4 status (verified 2026-10-05)

Awaiting owner review; not committed. No schema change: the Phase 2 catalog and versioned price tables were sufficient.

Done before Phase 4, as instructed:

- Permission decisions applied: OPERATOR cannot cancel orders; ADMIN may read the audit log; new `payments.refund` (refund of a FULFILLED order) granted to SUPER_ADMIN only. Unit-tested; SECURITY.md section 4 updated. No refund functionality yet.
- Local environment separation: `robux-dev` and `robux-prod` Compose projects with their own containers, networks and volumes (`robux-dev_pgdata`/`robux-dev_redisdata`, `robux-prod_pgdata`/`robux-prod_redisdata`). Existing development data was copied into the dev volumes (4 users, 5 products, 3 sources, 2 migrations verified after the move); the old shared volumes are kept untouched as a backup. Verified that each stack mounts only its own volumes and that the dev API cannot reach the production database. `COMPOSE_PROJECT_NAME` removed from `.env`/`.env.example`.

| Exit criterion | Result |
|----------------|--------|
| Product management | Pass: create (inactive, with price v1 in one transaction), update allowed fields, slug immutable, Robux amount and method locked once orders exist |
| Activation / deactivation | Pass: activation requires a price in force; deactivated products disappear from catalog, detail and quote (404); audited |
| Versioned pricing | Pass: new versions append (`basedOnVersion` check), scheduled future prices, no backdating, below-cost needs explicit confirmation, whole rupiah enforced |
| Historical prices immutable | Pass: v1 unchanged after v2; existing order keeps its snapshot and exact price version (tested in unit, integration and the Phase 2 trigger tests) |
| Admin authorization | Pass: ADMIN and SUPER_ADMIN manage products and prices; OPERATOR reads without costs; CUSTOMER and anonymous denied (tested per role) |
| Customer product display | Pass: `/products` page with ProductGrid/ProductCard, availability badges, backend prices; verified through Nginx in dev and production |
| Quantity validation | Pass: backend rejects 0, non-integers, non-numbers and values outside the product limits (`QUANTITY_OUT_OF_RANGE`); the selector clamps for UX only |
| Backend pricing authority | Pass: `quotePrice` is the only total computation; the UI displays the API quote (a component test proves it shows the API value rather than computing one); catalog, quote and admin prices are consistent (tested) |
| Reusable components | Pass: Badge, Table, ConfirmDialog, QuantitySelector, SelectField, PriceDisplay, ProductStatusBadge, ProductCard/Grid, ProductFields (shared by create and edit forms), PriceHistoryTable, NewPriceForm, ApiErrorAlert (replaces the auth-only error component), AdminShell |
| No duplicated logic | Pass: one quote function, one price-rule function, one money formatter per side, one error-to-copy mapping |
| Unit tests | Pass: 70 API (21 new) and 8 web component tests (new Vitest setup) |
| Integration tests | Pass: 103 (16 new products and pricing HTTP tests) |
| Phase 1 to 3 tests | Pass: all earlier tests unchanged and green |
| Docker regression | Pass: dev and production stacks rebuilt; production on its own empty volume: staff via CLI, TOTP login, product created, activated, repriced, stale change rejected, catalog and SSR pages show the new price, customer denied admin API, audit trail, isolation, worker restart, clean logs |
| Gitleaks | Pass |
| Documentation | Pass: ARCHITECTURE section 5.2, DATABASE section 4, SECURITY section 4, DEPLOYMENT section 3, ENGINEERING_STANDARDS section 12, CLAUDE.md, D-06 |
| No PM2, no commit, no push | Pass |

Known limitations: checkout (Buy button) is disabled until Phase 5; availability uses an aggregate of source balances until Phase 10; tax and customer fees are undecided (D-06); there is no product archive action yet (the column exists; no UI or endpoint).

## 15. Phase 5 status (verified 2026-10-05)

Awaiting owner review; not committed. Order engine only: no Duitku integration, no payment simulation, no fulfillment, no Roblox calls.

Decisions taken in this phase (recorded here and in ARCHITECTURE.md 6.1):

- Schema migration `20261005030000_order_tax_payment_deadline_pending_recipient` (additive): `orders.tax` so the snapshot holds every step of D-06; `orders.payment_expires_at` for the deadline; `recipient_roblox_user_id` nullable because the Roblox user id is resolved only by the documented lookup in Phase 11 (until then the username is stored and format-checked).
- Expiration: unpaid orders expire after `PAYMENT_EXPIRY_MINUTES` (system setting, default 60). This value is provisional, chosen so abandoned orders do not stay open; Phase 6 aligns it with the Duitku payment validity. The scheduler process runs the sweep every 60 s; Phase 7 replaces the interval with a BullMQ job scheduler.
- Idempotency: the idempotency row is written last in the order transaction, so a concurrent duplicate blocks on `UNIQUE(scope, key)` and then replays the committed response. Keys are scoped per customer or to guests. The tracking token inside the stored response is encrypted with the new secret `IDEMPOTENCY_ENCRYPTION_KEY`; nowhere else is it stored in plaintext.
- Staff accounts cannot place orders (`STAFF_CANNOT_ORDER`). Guests can cancel with their tracking token; customers cancel their own orders; ADMIN and SUPER_ADMIN cancel with a reason (audited); OPERATOR cannot cancel (owner decision).
- A product the stock cannot cover is refused (`PRODUCT_UNAVAILABLE`), in addition to the existing inactive and not-found cases.
- The full transition table is enforced at the single write path; Phase 5 exercises creation, cancellation and expiry.

| Exit criterion | Result |
|----------------|--------|
| Transactional creation into PAYMENT_PENDING | Pass: order, item snapshot, history NULL→CREATED→PAYMENT_PENDING, outbox `ORDER_CREATED` and idempotency record in one transaction (tested) |
| Backend-authoritative pricing | Pass: strict schema rejects any client amount (`total`, `unitPrice`, `discount`, `clientTotal` tested); totals from `quotePrice` only |
| Immutable price snapshot | Pass: product, quantity, unit price, price version, subtotal, discount, fee, tax, total, currency; a later price version leaves the order unchanged (tested) |
| Quote vs order | Pass: order creation re-validates product, availability, quantity and price; stale `priceVersionId` gives 409 `PRICE_CHANGED` (tested, also through Nginx in dev and production) |
| Idempotency | Pass: retry replays (201 + `Idempotent-Replayed`), different payload 422, 6 concurrent identical requests create 1 order, keys scoped per customer, missing or malformed key 400 (tested) |
| Guest and customer orders | Pass: guest tracking token (hash stored, shown once); customer orders owned and listed; guest email required; customer uses account email |
| IDOR | Pass: another customer order is 404 for read and cancel; guest cancel needs the token, never order number or id |
| Order numbers | Pass: `RBX-YYYYMMDD-NNNNN`, 8 concurrent creations give distinct well-formed numbers |
| Status history | Pass: every transition written atomically with the status change and its outbox event |
| Cancellation | Pass: customer, guest and admin; idempotent (one history row, one audit row); paid order 409 `ORDER_NOT_CANCELLABLE`; OPERATOR and CUSTOMER denied on admin cancel; CSRF enforced |
| Expiration | Pass: scheduler cancels only overdue unpaid orders (actor SCHEDULER, reason `PAYMENT_EXPIRED`, outbox `ORDER_EXPIRED`), second run changes nothing (tested; observed live in the dev stack) |
| Thin controllers | Pass: controllers validate and map HTTP; rules live in the services and domain |
| Error contract | Pass: `{code, message, requestId}` for all order errors, including 413 `PAYLOAD_TOO_LARGE` and malformed JSON (request id now assigned for body-parser errors too) |
| Rate limits | Pass: order creation 20/10 min per IP and 30/h per principal (429 tested); guest cancel 10/10 min per IP |
| Audit | Pass: staff cancellation audited with before/after and reason |
| Checkout UI | Pass: `features/checkout` (CheckoutView, CheckoutForm, ProductSummary, OrderSummary, CheckoutError, OrderConfirmation, useCheckout, checkout service) and the shared `PriceBreakdown`; Buy button links to `/checkout`; cancel buttons on tracking and account pages; the frontend never computes totals |
| Unit tests | Pass: 84 API (14 new), 18 web (10 new) |
| Integration tests | Pass: 135 (29 new order engine tests, 3 new constraint tests, Phase 2 to 4 tests updated for the new schema and error codes) |
| Regression | Pass: format, lint, typecheck, build, gitleaks; Docker dev and production stacks rebuilt and healthy, migration applied to both, smoke-tested through Nginx |
| No PM2, no commit, no push | Pass |

Known limitations: there is no payment yet, so every order ends cancelled or expired until Phase 6; the Roblox account is not verified until Phase 11; the production verification volume has no fulfillment source, so production checks covered the refusal paths (`PRODUCT_UNAVAILABLE`, `PRICE_CHANGED`, validation, idempotency, CSRF) and full creation was verified in the dev stack; the staff order list and admin order UI arrive with the admin console (Phase 13).

## 16. Phase 6 Payment Core status (2026-10-05)

Agent A (payment backend) part of Phase 6. Awaiting owner review; not committed. Built in parallel with the payment frontend (B), queue/worker (C), admin orders (D) and QA (E) in the same working tree.

Decisions taken in this phase (details: ARCHITECTURE.md §6.2, SECURITY.md §5, `docs/integrations/duitku.md` §9):

- Duitku contract taken from the official API reference and saved before coding (R-03). Signatures are HMAC-SHA256 (the page marks MD5/SHA-256 obsolete since Apr 2026).
- The callback signature does not cover `resultCode` or `reference`, so a callback only triggers verify-by-fetch (Check Transaction); the fetched status, reference and amount decide.
- No simulated gateway in the application. `PAYMENT_GATEWAY=none` (default) switches payment intake off; tests run the real adapter against a local stub of the documented responses.
- Payment expiry: `PAYMENT_EXPIRY_MINUTES` (order deadline, default 60) is unchanged; each Duitku attempt closes 5 minutes before the order deadline (`expiryPeriod`), capped by the documented per-method maximum, so a last-minute payment is verified before the expiry sweep runs. Fixed-window methods that would outlast the order are refused.
- One live attempt per order (partial unique index), so a customer cannot open two payable Duitku transactions; a new attempt is possible once the previous one failed or expired, and earlier attempts are kept.
- Money confirmed after the order expired or was cancelled marks the payment PAID and opens a reconciliation case; the order is not reopened (CANCELLED is terminal).
- Order status changes go through the existing transition table: the transition write moved into `orders/infrastructure/order-transition.writer.ts` (owner-approved additive change), used by the order repository unchanged in behaviour and by the payments repository inside the payment transaction. `PayableOrderService` (orders) gives payments owner- or token-scoped order data.
- Outbox events for Phase 7: `PAYMENT_CONFIRMED` (aggregate order) and `PAYMENT_RECONCILIATION_REQUIRED` (aggregate payment). No fulfillment request is written in Phase 6.

| Exit criterion | Result |
|----------------|--------|
| Contract from official docs | Pass: `docs/integrations/duitku.md` with source URL, retrieval date, inconsistencies and open items |
| Payment creation | Pass: owner/token scoped, strict body (client amounts rejected), amount = stored order total, `Idempotency-Key` required (replay, different-method 422, malformed 400), double click returns the live attempt, concurrent requests open one attempt, cancelled/near-deadline orders refused, gateway down → attempt FAILED and retry possible |
| Callback security | Pass: form encoding, field formats, merchant code, constant-time HMAC; forged, unsigned, foreign-merchant and malformed callbacks rejected (401/400) and recorded; optional source IP allow-list |
| Verify-by-fetch | Pass: an unconfirmed "success" callback changes nothing; amount, reference or currency mismatch → RECONCILIATION_REQUIRED, never PAID; gateway unreachable → 503 so Duitku retries, later success applies |
| Idempotency / replay | Pass: repeated and 5 concurrent identical callbacks → one PAID transition, one history row, one `PAYMENT_CONFIRMED` |
| Races | Pass: callback after expiry and callback racing the expiry sweep end consistent (PAID order, or CANCELLED order + reconciliation case) |
| Database | Pass: migration `20261005060000_payment_attempts` (one PENDING attempt per order, PAID requires a reference); applied to fresh test databases, the dev volume and the production volume; no drift |
| Unit tests | Pass: 175 API (payment rules, Duitku adapter with a fake HTTP layer, callback parser, signature vector, config) |
| Integration tests | Pass: 38 new payment tests; all 19 suites (194 tests) green including the queue suites |
| Regression | Pass: format, lint, typecheck, build, web tests, gitleaks, no PM2 |
| Docker | Pass: API image rebuilt, migration applied and API recreated (`--no-deps`) in `robux-dev` and `robux-prod`; health, payment methods, payment creation (payments off → 503), callback routing (404 off; with Duitku mode in dev: forged 401, JSON 400, no key in logs) checked through Nginx |
| No commit, no push | Pass |

Known limitations: no Duitku sandbox credentials yet, so the adapter has not exchanged a real request with Duitku (open items in `docs/integrations/duitku.md` §10, including the Check Transaction content type); refunds and voids are not implemented (no documented API); a cancelled order's live Duitku attempt cannot be voided, so paying it after cancellation ends in a reconciliation case; the reconciliation re-check (`VerifyPaymentService`) is not scheduled; payment method labels and fees come from the frontend catalog, not from Get Payment Method.

## 17. Post-Phase 5 audit remediation (2026-10-05)

Audit verdict was SAFE WITH FIXES. Remediated after Agents A–D froze the working tree; no new scope.

| Finding | Result |
|---------|--------|
| R1 Tracking token in API request logs | Fixed: request serializer masks `/track/:token`; redaction list extended (tracking, session, CSRF and idempotency values, recovery codes). Test sends a real request through the API logger. |
| R2 Transition cannot join a caller transaction | Already fixed by the payments work (`writeOrderTransition(tx, …)`); added outer-transaction rollback and commit tests. |
| R3 Several PENDING payments per order | Already fixed: partial unique index `payments_one_pending_per_order` plus reuse of the live attempt; 6-way concurrency test present and passing. |
| R4 Late payment after cancellation/expiry | Already implemented (payment PAID, order stays CANCELLED, reconciliation case, no `PAYMENT_CONFIRMED`); added tests for customer-cancelled, repeated and concurrent late callbacks; documented in ARCHITECTURE.md 5.3 and SECURITY.md 5. |
| R5 Queue TypeScript errors | Not reproducible after the freeze: typecheck clean. |
| R6 Duplicate expiry scheduler | Already fixed: the scheduler only registers BullMQ schedules, the worker processor is the only caller of `expireDue`; test now runs two schedulers and a second sweep and asserts one history row and one `ORDER_EXPIRED`. |
| R7 Frontend-only API contracts | Order and payment status lists and the staff order list contract moved to `@robux/shared`; unit tests keep the lists equal to the database enums. Payment UI view models stay in the web app (not API contracts). |
| R8 Payment redirect allowed `http:` | Fixed: only `https:` links and images; tests for http, javascript, data, file, ftp, protocol-relative and malformed values. The API already refuses non-HTTPS gateway URLs. |

## 18. Admin Console UX refactor, phase 1 (2026-10-05)

Frontend refactor plus one backend policy change; no change to payments, orders, fulfillment, the database schema or Docker.

- `/console` is the canonical staff UI (`/admin/*` page URLs redirect with 308; `/api/v1/admin/*` unchanged). Console shell with sidebar (drawer on phones), topbar with environment indicator and user menu, breadcrumbs and page headers; dashboard, orders, order detail, products, pricing overview and security pages. Poppins for the whole console through one token.
- Design system consolidated: one DataTable, Pagination, StatusBadge vocabulary, Dialog/ConfirmDialog, form field set, EmptyState, Skeleton, Toast, Panel, PageHeader, Breadcrumb. Removed duplicates: two PaymentStatusBadge implementations, Badge, Table/Th/Td, OrderMobileList, OrderSection, OrderDetailHeader, AdminShell, per-feature skeleton and pagination markup.
- Staff 2FA optional (backend: session state `NOT_ENROLLED` replaces `ENROLLMENT_REQUIRED`; full staff session without TOTP; TOTP still enforced for staff who enabled it). See SECURITY.md section 3.
- Backend dependencies, not built here: `GET /api/v1/admin/orders` (list), payment data in the staff order view, dashboard metrics, 2FA disable and recovery-code regeneration endpoints.

## 19. Phase 7 status: queue and async processing (2026-10-05)

Built on the queue foundation (ADR-004) without rebuilding it.

- New queue `order-processing` and job `order.payment-confirmed`, routed from `PAYMENT_CONFIRMED` through the existing outbox relay. Consumer `OrderPaymentConfirmedProcessor` checks the job against the committed outbox row and calls `QueuePaidOrderService`, which moves the order `PAID → QUEUED` through the single order transition writer and writes `FULFILLMENT_REQUESTED` in the same transaction (Phase 9 boundary, no route yet).
- Idempotency is the conditional order update; no lock beyond PostgreSQL. Malformed, forged or orphaned jobs fail without retry (`NonRetryableJobError`); infrastructure errors use the default retry policy.
- Event names for the order aggregate are defined once (`orders/domain/order-events.ts`); the payment writer uses the same constant.
- Not built (later phases): fulfillment engine and its route, notification consumers (`PAYMENT_RECONCILIATION_REQUIRED`), outbox pruning, stuck-order re-emission (reconciliation, §6.7).

## 20. Phase 8 status: mock fulfillment provider (2026-10-05)

- `FulfillmentProvider` port with typed balance, recipient validation, fulfillment and verification results and normalized error codes (`modules/fulfillment/domain`). `FulfillmentProviderRegistry` by source provider code, no fallback; `ObservedFulfillmentProvider` logs every call. ADR-005 records the decisions.
- `MockFulfillmentProvider`: deterministic scenarios (SUCCESS, PENDING with settle, PARTIAL, RETRYABLE_FAILURE, PERMANENT_FAILURE, SUCCEEDED_BUT_TIMED_OUT, INVALID_RECIPIENT, UNAVAILABLE), fixed test recipients, configurable balance with INSUFFICIENT_BALANCE, in-memory ledger for idempotency and truthful verify. The plan's TIMEOUT case is `SUCCEEDED_BUT_TIMED_OUT`; per-source scenarios are deferred to Phase 10.
- `FULFILLMENT_PROVIDER=none|mock` (default none); mock refused in production by configuration loading in every process. No Compose change: the worker gets the variable when Phase 9 needs it.
- Reusable adapter contract suite (`apps/api/test/contracts/fulfillment-provider.contract.ts`), run against the mock.
- Phase 9 boundary: the engine consumes `FULFILLMENT_REQUESTED`, uses the registry and port, and owns the QUEUED → PROCESSING → … transitions, attempts and allocations. Nothing of that is built here.

## 21. Phase 7.1 status: design system and UI standardization (2026-10-05)

Frontend only (`apps/web`). There are no changes to the API, business logic, authorization, routes or the schema; `/admin/*` redirects still work.

- **Canonical UI standard.** Written in ENGINEERING_STANDARDS.md §4.4; it is binding for Phases 8–18.
  - New: Icon (Iconsax via `iconsax-react` 0.0.8), IconButton, FormDialog, DropdownMenu, PageSizeSelect, `pagination-model`, `useClientPagination`, ThemeSwitcher.
  - Rebuilt: Dialog, ConfirmDialog, DataTable, Pagination, Button variants, Alert, Toast, EmptyState, CopyButton, FormField.
- **Tables.** Every console table is a DataTable:
  - a "No." column;
  - "Tampilkan" 10/25/50/100 (default 10) at the bottom left and pagination at the bottom right;
  - Skeleton, EmptyState and error states.
  - Orders default to 10 per page (was 20).
- **CRUD.**
  - Product create, edit and status changes, and new prices, run in dialogs with shared fields.
  - Removed: the `/console/products/new` page, CreateProductForm, ProductEditForm, ProductStatusControl, NewPriceForm and OrderListPagination.
- **Theme.** Light, Dark and System on semantic tokens; class names migrated across 75 files (`text-muted` became `text-muted-foreground`, `gold` became `primary`, `line` became `border`, …).
- **Sidebar.** No border; the active item is shown by background, text weight and a bold icon. Icons in the navigation, topbar, buttons and feedback.
- **Tests.** New tests cover pagination numbering across pages, page-size reset, the page window, DropdownMenu keyboard behaviour, Dialog and ConfirmDialog, Icon and IconButton accessibility, the ThemeSwitcher cookie and `data-theme`, and the product dialogs calling the service.

## 22. Phase 9 status: fulfillment engine (2026-10-05)

Decisions recorded in ADR-006; flow in ARCHITECTURE.md §6.4.

- **Consumer.** `FULFILLMENT_REQUESTED` is routed to `fulfillment.requested` on the new `fulfillment` queue, but only when `FULFILLMENT_PROVIDER` is not `none`. `FulfillmentRequestedProcessor` checks the job against the committed outbox row; `FulfillmentEngine` reloads the order and runs one step per job run.
- **Engine.** Focused parts:
  - lease and transactional persistence (`PrismaFulfillmentWorkflowRepository`);
  - `FulfillmentAttemptExecutor` (recipient check, balance check, attempt committed before the call, `fulfill`);
  - `FulfillmentAttemptVerifier` (verify only);
  - pure `resolveFulfillResult` / `resolveVerification` / `planFulfillment`.

  Providers are reached only through `FulfillmentProviderRegistry` (Phase 9 used a single-provider selector token; Phase 10 replaced it with routing and allocations).
- **Safety.**
  - One run per order through a PostgreSQL lease.
  - One live attempt per order and one delivery per client reference (partial unique indexes).
  - Deterministic client reference reused by every retry of an undelivered request.
  - Unknown and pending outcomes are verified, never re-sent; only verification `NOT_FOUND` makes a request retry-eligible.
  - Each step commits attempt, amounts, order transitions, history, outbox events and lease release in one transaction.
- **Retries.** The canonical policy (5 s … 5 min, 5 runs) is reused through BullMQ. Automatic retries are bounded in PostgreSQL. Exhaustion ends in `FAILED_PERMANENTLY` (`RETRY_EXHAUSTED`, last error kept); still unknown at the end ends in `RECONCILIATION_REQUIRED`.
- **Schema** (migration `20261005090000_fulfillment_engine`):
  - `fulfillment_orders.lease_token`, `lease_expires_at` (+ CHECK);
  - `fulfillment_attempts.allocation_id` nullable;
  - `client_reference` text, no longer unique per row;
  - new partial unique indexes `fulfillment_attempts_one_live_per_order` and `fulfillment_attempts_one_delivery_per_reference`;
  - index on `client_reference`.
- **Other changes.**
  - `writeOrderTransition` sets `orders.fulfilled_at` on FULFILLED.
  - Order events `FULFILLMENT_STARTED/_PENDING/_PARTIAL/_FAILED/_RETRYING/_PERMANENTLY_FAILED/_COMPLETED/_RECONCILIATION_REQUIRED` (not routed).
  - The mock's provider references are unique per process (a restarted worker reused `MOCK-000001`, which the unique `(provider, external_reference)` refuses).
- **Compose.** Development worker `FULFILLMENT_PROVIDER=mock` (`MOCK_FULFILLMENT_SCENARIO`, default SUCCESS); production worker `FULFILLMENT_PROVIDER=none`.
- **Deferred to Phase 10** (plan row 9 listed them; the Phase 9 brief excludes inventory):
  - single-source atomic reservation, allocation release on failure;
  - cost snapshot per allocation;
  - fulfillment kill switch.

  Also deferred: a long-running verify job for providers that settle after the retry schedule, and the stuck-order sweep (§6.7).

## 23. Phase 10 status: inventory and smart routing (2026-10-05)

Decisions in ADR-007; routing in ARCHITECTURE.md §6.5; ledger and constraints in DATABASE.md §8.

- **Routing.** `inventory/domain/routing.ts` (`SMART_V1`, pure and deterministic) applies D-08:
  1. active, healthy, provider-configured sources with balance only;
  2. full coverage;
  3. fewest sources;
  4. least surplus;
  5. priority, then cost, then id.

  Split plans drain smaller sources first. Each allocation records the decision.
- **Allocation boundary.** `FulfillmentAllocationService` replaces the Phase 9 single-provider selector. It reuses an open allocation or routes and reserves the remaining amount atomically, re-routing on a lost race, and reports `NO_ELIGIBLE_SOURCE` explicitly. The engine executes split plans allocation by allocation in one run.
- **Ledger** (`inventory-ledger.writer.ts`, inside the step transaction):
  - reserve, consume, release (idempotent);
  - edge-triggered low balance (`SOURCE_LOW_BALANCE`);
  - provider health counter (`SOURCE_UNAVAILABLE` after 3 consecutive failures).

  Partial deliveries keep the remainder reserved; failures release that source; the end of the workflow releases everything. There is no time-based expiry.
- **Health.** `inventory.source-health-check` (scheduler, every minute, queue `inventory-sync`) restores `UNAVAILABLE`/`UNKNOWN` sources whose provider answers. The kill switch is `status=DISABLED`.
- **Staff.**
  - API: `/api/v1/admin/inventory/sources` (list, create, edit, activate/deactivate, adjust) with RBAC and audit; costs only with `inventory.manage`.
  - Console: `/console/inventory` built from Phase 7.1 components (DataTable with No./Show/pagination, FormDialog create/edit/adjust, ConfirmDialog kill switch, Iconsax `inventory`/`adjust` icons, light and dark).
- **Schema.** Migration `20261005100000_inventory_routing` (see DATABASE.md §8).
- **Tests.** Routing matrix and property test; engine with inventory (reserve once, release on failure, keep on unknown or partial, multi-source, kill switch, health failover). PostgreSQL concurrency: 2 and 10 orders on one source, two 1500 orders on two sources. Ledger, low-balance edge and recovery, health, constraints, admin API RBAC and audit, and web table and dialogs.
- **Not in Phase 10:** provider balance sync and reconciliation (the provider stays the authority on its external balance), notification consumers for the new events, per-source mock scenarios in the running worker (tests use separate provider codes), reservation expiry.

## 24. Phase 11 status: authorized provider integration (2026-10-05) — BLOCKED

- **Blocked on D-01.** No authorized provider has been identified, and no official API documentation, authorization confirmation or sandbox credentials are in the repository (`docs/integrations/` holds only the Duitku contract). Following R-01 and the "never invent external API contracts" rule, no provider adapter, client, configuration or webhook was written.
- **Ready.** The provider port (ADR-005), registry and `configured-providers.ts` registration point, the engine (ADR-006), inventory and routing (ADR-007), the source kill switch and health check, and the contract suite (`test/contracts/fulfillment-provider.contract.ts`).
- **Onboarding.** Requirements, plug-in points, adapter rules, the production gate and rollback are in `docs/integrations/fulfillment-provider-onboarding.md`. It includes one engine gap to close from the provider's documentation: a settle window before verification `NOT_FOUND` makes a request retry-eligible.
- **Production** stays at `FULFILLMENT_PROVIDER=none`; the mock is refused in production.

## 25. Phase 11 status: Digital Fulfillment Core adaptation (2026-10-06)

Phase 11 was redefined. The authorized-provider integration (§24) stays blocked on D-01; this phase makes the core product-agnostic instead. Decisions are in ADR-009.

- **Baseline before changes.**
  - API unit 341/341; web 145/145; typecheck and lint clean.
  - Integration 244/245 under parallel load: the Phase 7 "forged job" timing test failed while web tests ran at the same time, then passed 9/9 alone.
- **Audit (summary).**
  - Robux assumptions were in the product model (`robux_amount`, no product kind), orders (`recipient_username` required, Roblox-only checkout schema), the provider port (`robloxUsername`, `robuxAmount`, `balance.robux`), routing (all sources were one pool) and stock availability (one Robux total).
  - Reusable without change: order state machine, engine workflow (lease, attempts, verify, retry, reconciliation), outbox and queues, allocation and reservation ledger, payments, RBAC, design system.
- **Changes.**
  - Product lines with a derived profile (platform, fulfillment type, recipient, unit).
  - Server-side recipient resolution; order snapshot columns with CHECKs.
  - Fulfillment strategies selected by the snapshot.
  - Generalized provider port (`recipient {type, identifier, externalUserId} | null`, `amount`, `units`); per-line sources, routing and availability.
  - Admin product and source dialogs and tables show and set the line; order detail shows the line, type and recipient (or "none").
  - Seed adds inactive Telegram Premium, Stars and account products.
- **Not built (Phase 12+):** Telegram supplier integrations, the Telegram checkout UI, account item storage and delivery to the customer, the inventory UI for accounts, and any real provider (D-01).
