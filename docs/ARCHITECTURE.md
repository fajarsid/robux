# Architecture

**Status:** Target architecture, Phase 0. Nothing below is implemented yet.
**Sources:** `docs/PRD.md`, Master Build Prompt, ADR-001, ADR-002.

---

## 1. System context

```text
 Customer browser ──┐                      ┌── Payment gateway (TBD, see Open Decisions)
 Admin browser ─────┤                      │      ▲ create charge / query status
                    ▼                      │      │ signed webhook
               Cloudflare (TLS, WAF, CDN)  │      │
                    │                      ▼      │
                  Nginx ── api.<domain> ──▶ NestJS API ◀┘
                    │                      │
                    └── app.<domain> ──▶ Next.js   │ writes
                         (SSR calls http://api:4000 ▼
                          on the internal network) PostgreSQL ◀── source of truth
                                           ▲
                                           │ outbox poll / state reads + writes
                                        Worker(s) ──▶ Redis/BullMQ (jobs, locks, rate limits)
                                           │                 ▲
                                           │                 │ repeatable jobs
                                           │             Scheduler
                                           ▼
                        Fulfillment provider adapters (mock first; real provider TBD)
                        Roblox adapter (identity lookup only)
                        Notification adapters (Telegram, Discord, email)
```

Trust boundaries: browser ↔ Cloudflare, Cloudflare ↔ Nginx (origin), Nginx ↔ app containers, app ↔ external providers, app ↔ data stores. See `SECURITY.md`.

---

## 2. Repository layout

Conventions for this layout are in `ENGINEERING_STANDARDS.md` §3–§4.

pnpm workspace monorepo:

```text
/
├── apps/
│   ├── api/                    NestJS: api, worker, scheduler entrypoints (ADR-001)
│   │   ├── prisma/             schema.prisma, migrations/, seed.ts
│   │   ├── src/
│   │   │   ├── main.ts         HTTP entrypoint
│   │   │   ├── worker.ts       BullMQ consumers entrypoint
│   │   │   ├── scheduler.ts    repeatable-job registration entrypoint
│   │   │   ├── config/         environment loading and validation
│   │   │   ├── common/         shared infrastructure only: database, redis, logging, errors, health, lifecycle
│   │   │   ├── processes/      worker and scheduler runtimes, background health server
│   │   │   └── modules/        health, auth, users, products, pricing, orders, payments, fulfillment,
│   │   │                       inventory, roblox, gamepass, notifications, webhooks, administration,
│   │   │                       audit, outbox, reconciliation, metrics
│   │   │                       (each: controllers/ dto/ application/ domain/ infrastructure/ as needed)
│   │   └── test/               integration + e2e (API level)
│   └── web/                    Next.js App Router: storefront, account, admin
│       ├── messages/  src/app/  src/components/{ui,layout,feedback,forms}/  src/features/<feature>/  src/lib/
│       └── e2e/                Playwright
├── packages/
│   ├── shared/                 zod DTO schemas, enums, error codes, money helpers (no runtime deps on Nest/Next)
│   └── config/                 shared tsconfig, eslint, prettier
├── infra/
│   ├── nginx/                  nginx.conf, site config, Cloudflare real-IP list
│   ├── postgres/               init scripts, backup scripts
│   └── docker/                 Dockerfiles
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── .env.example
├── .github/workflows/ci.yml
└── docs/
```

Why one `packages/shared`: request/response schemas are defined once (zod), used for API validation and for typed frontend calls. The frontend never imports backend business logic, only shapes and enums.

---

## 3. Container topology

Docker-first (ADR-002): Docker Compose manages every application process and its lifecycle. Nginx is the reverse proxy / edge gateway. PM2 is not used anywhere, on the host or in images. No application service runs directly on the host.

```text
Internet ─▶ Cloudflare ─▶ VPS :80/:443
                              │
                     [edge]  nginx
                              │
             [app, internal]  ├── app.<domain> ─▶ frontend:3000 ──SSR──▶ api:4000
                              └── api.<domain> ─▶ api:4000
                                                     │ enqueue (via outbox)
            [data, internal]  postgres:5432 ◀────────┼──────── worker ──▶ [egress] providers
                              redis:6379    ◀────────┴──────── scheduler
```

| Service     | Image / command                    | Networks             | Published (prod) | Restart          | Health check |
|-------------|------------------------------------|----------------------|------------------|------------------|--------------|
| `nginx`     | nginx stable                       | edge, app            | 80, 443          | unless-stopped   | `nginx -t` + local HTTP probe |
| `frontend`  | app-web, `node server.js` (standalone) | app              | none             | unless-stopped   | `GET /api/healthz` (Next route handler) |
| `api`       | app-api, `node dist/main.js`       | app, data, egress    | none             | unless-stopped   | `GET /health/ready` |
| `worker`    | app-api, `node dist/worker.js`     | data, egress         | none             | unless-stopped   | `127.0.0.1:4001/health/live` (heartbeat) + `/health/ready` (PostgreSQL, Redis) |
| `scheduler` | app-api, `node dist/scheduler.js`  | data, egress         | none             | unless-stopped   | `127.0.0.1:4002/health/live` + `/health/ready` |
| `migrate`   | app-api, `prisma migrate deploy`   | data                 | none             | no (one-shot)    | exit code 0 |
| `postgres`  | postgres (pinned major)            | data                 | none             | unless-stopped   | `pg_isready` |
| `redis`     | redis (pinned major)               | data                 | none             | unless-stopped   | `redis-cli ping` (with auth) |

Network rules:

- `edge` is the only network with published host ports, and only `nginx` is on it.
- `app` and `data` are `internal: true` (no route to the internet). PostgreSQL and Redis are only on `data`, so neither Nginx nor the frontend can reach them.
- `egress` gives outbound internet to the three processes that call external services (payment gateway, Roblox, fulfillment providers, Telegram/Discord/email). It has no published ports.
- The frontend has no egress. Roblox avatar images are loaded by the browser directly from Roblox's CDN (allow-listed in CSP `img-src`), not through `next/image` server-side optimisation.

Worker separation: the API container never executes fulfillment. It commits state + outbox rows; the outbox relay (in `worker`) enqueues BullMQ jobs; `worker` containers consume them. `worker` can be restarted or scaled (`--scale worker=N`) without touching the API. `scheduler` only registers repeatable jobs and can be redeployed on its own.

Redis configuration requirements (BullMQ): `maxmemory-policy noeviction`, AOF enabled (`appendonly yes`, `appendfsync everysec`), password required. Redis loss must be survivable anyway (see §8).

Request routing at Nginx (ADR-008): `app.<domain>/api/*` goes to `api:4000` (browser calls are same-origin, so the session cookie is host-only and browsers need no CORS); other `app.<domain>` paths go to `frontend:3000`; `api.<domain>` goes to `api:4000` for webhooks and server-to-server calls. `/health` and `/health/live` are public on the API host; `/health/ready`, `/metrics` and the frontend `/healthz` are denied at the edge. Docker health checks call each container directly. Deployment details: `DEPLOYMENT.md`.

---

## 4. Backend module map

| Module          | Owns (tables)                                                     | Exposes                                    |
|-----------------|-------------------------------------------------------------------|--------------------------------------------|
| `auth`          | `user_sessions`, `admin_2fa`, `login_attempts`                    | login, logout, 2FA, session guard, role guard |
| `users`         | `users`                                                           | profile, admin user management             |
| `products`      | `products`                                                        | catalog read, admin CRUD                   |
| `pricing`       | `product_prices`                                                  | `PriceQuote` calculation (pure), price history |
| `orders`        | `orders`, `order_items`, `order_status_history`, `order_number_counters`, `idempotency_keys` | create order, state machine, tracking |
| `payments`      | `payments`                                                        | create payment, apply verified payment events |
| `webhooks`      | `webhook_events`                                                  | receive, verify, persist, dispatch         |
| `fulfillment`   | `fulfillment_orders`, `fulfillment_attempts`                      | fulfillment engine, provider resolver      |
| `inventory`     | `fulfillment_sources`, `fulfillment_allocations`, `source_balance_logs` | reserve / consume / release, routing, sync |
| `roblox`        | none (cache only)                                                 | `RobloxIdentityPort` (resolve username → user id, display name, avatar) |
| `gamepass`      | `gamepass_orders`                                                 | gross-up calculator, delayed-fulfillment flow |
| `notifications` | `notifications`                                                   | channel adapters, templates, delivery log  |
| `outbox`        | `outbox_events`                                                   | `OutboxWriter` (in-transaction), relay worker |
| `reconciliation`| `reconciliation_cases`                                            | mismatch detection, admin resolution       |
| `audit`         | `audit_logs` (append-only)                                        | `AuditWriter`                              |
| `admin`         | none                                                              | dashboard aggregations, admin controllers composing other modules |
| `health`/`metrics` | none                                                           | `/health*`, Prometheus `/metrics` (internal port) |

Controllers validate input (zod via shared schemas), call one application service, map the result. No transaction management or business branching in controllers.

---

## 5. Domain model

### 5.1 Money and quantities

- Currency amounts: PostgreSQL `NUMERIC(18,2)`, Prisma `Decimal`, `decimal.js` in code. Never `float`/`number` for money. API serialises money as strings.
- Currency stored per row (ISO 4217). Initial currency expected: IDR (PRD examples use Rp). Rounding: half-up, applied once at line-total level; documented in `pricing` tests.
- Robux quantities: `INTEGER` per order line, `BIGINT` for source balances and ledger. API serialises `BIGINT` as string.

### 5.1a Product lines (Phase 11, ADR-009)

Every product has a `product_line` (`ROBLOX_ROBUX`, `TELEGRAM_PREMIUM`, `TELEGRAM_STARS`, `TELEGRAM_ACCOUNT`). One table in `products/domain/product-line.ts` derives the platform, the fulfillment type (`BALANCE_PURCHASE`, `RECIPIENT_FULFILLMENT`, `DIGITAL_DELIVERY`), the recipient kind (Roblox user, Telegram user, none) and the unit (Robux, Premium months, Stars, accounts). Checkout accepts exactly the recipient kind the line requires (`resolveOrderRecipient`); the client never names a fulfillment type. Orders snapshot `product_line`, `platform`, `fulfillment_type` and `recipient_type` under CHECK constraints. Sources belong to one line, and routing and stock availability are per line. `robux_amount`/`totalRobux` keep their names and mean units of the line.

### 5.2 Pricing

`products` holds catalog identity (name, slug, robux amount, fulfillment method, limits, active flag). `product_prices` is an append-only, versioned price table (`selling_price`, `cost_price`, `currency`, `effective_from`, `created_by`). The current price is the latest effective row. This resolves the PRD overlap where both `products` (§46) and `product_prices` (§27/§44) carry prices: price history lives in `product_prices`; `products` does not store a mutable price.

Implemented in Phase 4:

- `modules/pricing`: price-version rules (positive, whole rupiah, explicit confirmation below cost, no backdating), active-price selection (latest `effective_from <= now`, ties by version), and `quotePrice`, the single function that computes subtotal and total for a quantity. `PriceVersionService.appendVersion` requires `basedOnVersion` equal to the latest version, so stale views and double submits fail with `PRICE_VERSION_CONFLICT`; the unique `(product_id, version)` constraint settles concurrent requests.
- `modules/products`: product rules (quantity limits `1 <= min <= max <= 100`; Robux amount and fulfillment method locked once orders exist; activation requires a price in force), admin commands (audited: `PRODUCT_CREATED`, `PRODUCT_CHANGED`, `PRODUCT_ACTIVATED`, `PRODUCT_DEACTIVATED`, `PRICE_CHANGED`) and the storefront catalog. A product is created inactive together with price version 1 in one transaction. Products depend on pricing, never the reverse.
- Availability (PRD §77): active, has a price in force, and the stock reader (`modules/inventory`) reports enough Robux in ACTIVE and HEALTHY/DEGRADED sources for the minimum quantity. Phase 10 replaces the aggregate with routing-aware availability.
- Endpoints: `GET /api/v1/products`, `GET /api/v1/products/:slug`, `GET /api/v1/products/:slug/quote?quantity=n` (public); `GET/POST /api/v1/admin/products`, `GET/PATCH /api/v1/admin/products/:id`, `POST .../activate`, `POST .../deactivate`, `POST .../prices` (permission-guarded).
- The frontend shows the quote returned by the API and never multiplies prices itself; products and prices exist only in the database (the PRD product set is seed data).

Phase 5 (D-06 confirmed): `quotePrice` runs the chain subtotal → discount → fee → tax → total, with the adjustable steps supplied by `PriceAdjustmentRules` (`pricing/domain/price-adjustments.ts`). The rules in force return zero for discount, fee and tax, so `total = subtotal` in IDR; introducing any of them replaces the rules only. A discount outside `[0, subtotal]` or a negative fee or tax is refused. The quote returns every step plus the `priceVersionId` it is based on.

At order creation, the checkout uses the same `quotePrice` for the totals and stores them as the order snapshot (`subtotal`, `discount`, `fee`, `tax`, `total`, `currency`). The order item stores snapshots (`unit_price_snapshot`, `unit_cost_snapshot`, `product_name_snapshot`, `robux_amount`, `price_version_id`). Later price changes never touch existing orders (PRD §32, Scenario H).

### 5.3 Order state machine

Order status is the customer-visible lifecycle. Transitions are defined in one table in `orders/domain/order-state-machine.ts` (`canTransition`, `assertTransition`, `isCancellable`). Every status change goes through `OrderStatusTransitionRepository.apply`, which rejects anything outside the table (`INVALID_ORDER_TRANSITION`) before touching the database (tested); order creation asserts `CREATED → PAYMENT_PENDING` the same way. The repository performs a **conditional update** (`UPDATE … WHERE id = $1 AND status = $expected`) so concurrent writers cannot both win. Every transition writes `order_status_history` and an outbox event in the same transaction.

```text
CREATED ──▶ PAYMENT_PENDING ──▶ PAID ──▶ QUEUED ──▶ PROCESSING ──▶ FULFILLMENT_PENDING ──▶ FULFILLED
   │              │               │         │            │                 │
   ▼              ▼               ▼         ▼            ├─▶ FAILED ◀──────┤
CANCELLED     CANCELLED      REFUND_PENDING            │      │           │
           (expired/customer)                           │      ├─▶ RETRYING ──▶ PROCESSING
                                                        │      └─▶ FAILED_PERMANENTLY
                                                        ├─▶ PARTIALLY_FULFILLED ──▶ RETRYING (remaining only)
                                                        └─▶ RECONCILIATION_REQUIRED
```

| From                     | Allowed to                                                                 | Triggered by |
|--------------------------|----------------------------------------------------------------------------|--------------|
| CREATED                  | PAYMENT_PENDING, CANCELLED                                                 | payment created / customer, expiry |
| PAYMENT_PENDING          | PAID, CANCELLED, RECONCILIATION_REQUIRED                                   | verified webhook / expiry or customer / amount mismatch |
| PAID                     | QUEUED, REFUND_PENDING                                                     | outbox relay / admin |
| QUEUED                   | PROCESSING, REFUND_PENDING                                                 | worker claim / admin |
| PROCESSING               | FULFILLMENT_PENDING, FAILED, PARTIALLY_FULFILLED, RECONCILIATION_REQUIRED  | engine |
| FULFILLMENT_PENDING      | FULFILLED, PARTIALLY_FULFILLED, FAILED, RECONCILIATION_REQUIRED            | verification |
| FAILED                   | RETRYING, FAILED_PERMANENTLY                                               | retry policy |
| RETRYING                 | PROCESSING                                                                 | worker claim |
| PARTIALLY_FULFILLED      | RETRYING, FAILED_PERMANENTLY, REFUND_PENDING                               | retry policy / admin |
| FAILED_PERMANENTLY       | RETRYING, REFUND_PENDING                                                   | admin manual retry / admin |
| RECONCILIATION_REQUIRED  | FULFILLED, PARTIALLY_FULFILLED, FAILED, PAID, CANCELLED                    | reconciliation result or admin resolution (audited) |
| REFUND_PENDING           | REFUNDED                                                                   | gateway refund confirmation |
| FULFILLED, CANCELLED, REFUNDED | terminal (FULFILLED → REFUND_PENDING only for SUPER_ADMIN exception, PRD §72) | — |

Notes on PRD alignment:

- PRD §12 `REMAINING_FULFILLMENT` is modelled as `RETRYING` with `fulfillment_orders.remaining_amount > 0`, not a separate order status. Same behaviour, fewer states.
- `FULFILLMENT_PENDING` means "executed, awaiting authoritative verification" (master prompt §55 `VERIFYING`). The per-attempt `VERIFYING` state lives on `fulfillment_attempts`.
- `RECONCILIATION_REQUIRED` (master prompt §26, PRD §81) is an order status so it is visible in the monitor and blocks automatic progress.
- Gamepass states (PRD §29) live on `gamepass_orders`; the parent order sits in `PROCESSING`/`FULFILLMENT_PENDING` meanwhile.
- Payment expiry is `CANCELLED` with `cancel_reason = PAYMENT_EXPIRED`.
- There is no `CANCELLED → PAID` transition. A payment confirmed by the gateway after the order was cancelled or expired is recorded as a PAID payment, the order stays `CANCELLED`, and a reconciliation case (`PAYMENT_STATUS_MISMATCH`, evidence `ORDER_NOT_AWAITING_PAYMENT`) is opened in the same transaction. No `PAYMENT_CONFIRMED` event is written, so nothing can start fulfillment; staff resolve the case (refund or manual decision).
- `writeOrderTransition(tx, transition)` (`orders/infrastructure/order-transition.writer.ts`) is the single writer. It runs inside the caller's transaction, so a payment update, the order transition, its history row and its outbox event commit or roll back together (tested with an outer rollback); `OrderStatusTransitionRepository.apply` wraps it in its own transaction for callers that have none.
- Cancellation (customer, guest token holder, staff) is allowed only in `CREATED` and `PAYMENT_PENDING`. After payment the path is a refund, never a cancellation. Cancelling an already cancelled order succeeds without writing a second history row.

### 5.4 Fulfillment model

```text
orders 1───1 fulfillment_orders (requested, fulfilled, remaining, status)
                    │
                    1───* fulfillment_allocations (source_id, amount, consumed, released,
                    │          │                   status: RESERVED|CONSUMED|RELEASED, unit_cost_snapshot)
                    │          1───0..1 fulfillment_attempts (allocation_id UNIQUE, attempt_number, provider,
                    │                          requested, fulfilled, client_reference, external_reference,
                    │                          status, error) ──1───* fulfillment_attempt_status_history
```

Attempt statuses: `PENDING → EXECUTING → VERIFYING → SUCCEEDED | PARTIAL | FAILED_RETRYABLE | FAILED_PERMANENT | UNKNOWN`.
`UNKNOWN` means we cannot tell whether the provider executed (timeout, crash after send). `UNKNOWN` is never retried by execution; it is resolved by verification or reconciliation.

Constraints (full list in `DATABASE.md` §7–§8): `UNIQUE(fulfillment_orders.order_id)`, `UNIQUE(fulfillment_attempts.fulfillment_order_id, attempt_number)`, partial `UNIQUE(fulfillment_attempts.client_reference) WHERE status IN (SUCCEEDED, PARTIAL)` and `UNIQUE(fulfillment_attempts.fulfillment_order_id) WHERE status IN (PENDING, EXECUTING, VERIFYING, UNKNOWN)` (Phase 9, ADR-006), `UNIQUE(fulfillment_attempts.allocation_id)` (nullable until Phase 10), `CHECK(fulfilled_amount <= requested_amount)`, `CHECK(remaining_amount = requested_amount - fulfilled_amount)`, allocation settlement CHECKs.

### 5.5 Inventory

`fulfillment_sources` keeps `available_balance` and `reserved_balance` (`BIGINT`, `CHECK >= 0`), `status` (ACTIVE/DISABLED), `health` (HEALTHY/DEGRADED/UNAVAILABLE/UNKNOWN), `priority`, `cost_per_unit` (optional), `low_balance_threshold`, `provider`, `credential_ref` (name of a secret, never the secret).

`source_balance_logs` is an append-only ledger: every reserve, consume, release, sync and staff adjustment writes a row with delta, resulting balances, reason and correlation (order/allocation id).

Since Phase 10 (ADR-007): `low_balance_since` (edge-triggered `SOURCE_LOW_BALANCE`, one alert per crossing below the threshold) and `consecutive_failures` (1 provider failure → `DEGRADED`, 3 in a row → `UNAVAILABLE` + `SOURCE_UNAVAILABLE`; any success → `HEALTHY`; the `inventory.source-health-check` job restores `UNAVAILABLE`/`UNKNOWN` sources whose provider answers). `status=DISABLED` is the kill switch: no new allocations, existing ones finish. Allocations snapshot `cost_per_unit` (`unit_cost_snapshot`, NULL when not configured) and record the routing strategy and decision. Staff manage sources at `/api/v1/admin/inventory/sources` (`inventory.read` to list, costs and changes with `inventory.manage`, audited) and in the console at `/console/inventory`.

---

## 6. Core flows

### 6.1 Order creation

**Decisions D-03/D-04:** guest checkout is supported and registration is never required to buy. Customer accounts are optional (server-side sessions, no JWT for browsers). Admin authentication is separate (staff roles, optional TOTP that is enforced once enabled; owner decision 2026-10-05).

- Guest order: `user_id = NULL`, contact email stored, and a **guest tracking token** generated: 256-bit from the OS CSPRNG, base64url (43 chars), non-sequential, unrelated to ids or order number. Only its SHA-256 hash is stored (`orders.tracking_token_hash`, unique). The plaintext is shown once on the confirmation page and sent by email.
- Tracking page: `/order/{guest_tracking_token}` → `GET /api/v1/track/{token}`. Response exposes order number, product, amount, public status timeline. Never internal UUIDs, provider names, references or error details.
- Token lookups are rate-limited per IP (Nginx + API), constant-time hash lookup, uniform 404 for unknown tokens. The tracking page sends `Referrer-Policy: no-referrer`, and Nginx access logs mask the token segment of `/order/` and `/api/v1/track/` paths.
- Registered customer: login → profile → order history (`/account/orders/[id]`, ownership checked). Guest orders can be attached to an account later after email verification.

Implemented in Phase 5 (`modules/orders`): `OrdersController` → `CreateOrderService` → `CatalogService.offerForPurchase` + `quotePrice` → `OrderCreationRepository` → PostgreSQL. Controllers only validate input and map HTTP.

```text
POST /api/v1/orders   (Idempotency-Key header required; session optional; staff sessions refused)
  1. Validate body with createOrderRequestSchema (strict: productId, quantity, priceVersionId,
     recipient.robloxUsername, contactEmail for guests). Any amount field is an unknown key → 400.
  2. Key format ^[A-Za-z0-9_-]{16,128}$, else IDEMPOTENCY_KEY_REQUIRED. Scope orders.create:customer:<id>
     or orders.create:guest. request_hash = SHA-256 of the canonical request (with the effective email).
  3. Known key: same hash → replay the stored response (201, Idempotent-Replayed: true);
     other hash → 422 DUPLICATE_IDEMPOTENCY_KEY.
  4. Product: archived or missing → PRODUCT_NOT_FOUND; inactive or unpriced → PRODUCT_INACTIVE;
     priceVersionId not the price in force → 409 PRICE_CHANGED; stock cannot cover → PRODUCT_UNAVAILABLE.
  5. quotePrice → full snapshot. Payment deadline = now + PAYMENT_EXPIRY_MINUTES (system setting, default 60).
  6. Allocate the order number; generate the guest tracking token (hash stored).
  7. One transaction: order (CREATED) + item snapshot → history NULL→CREATED → PAYMENT_PENDING
     + history → outbox ORDER_CREATED → idempotency_keys row (COMPLETED, sealed response) last.
  8. A concurrent request with the same key blocks on UNIQUE(scope, key) until the first commits,
     then gets a unique violation, rolls back its own order and replays the stored response.
  9. 201 with order number, tracking token, stage, full price breakdown, payment deadline (+ orderId for customers).
```

The Roblox account is identified by username only in Phase 5 (format check); `recipient_roblox_user_id` stays NULL until the Phase 11 documented lookup resolves it. No payment intent exists yet (Phase 6): the order waits in `PAYMENT_PENDING`, and the UI states that payment is not available and nothing has been delivered.

The stored response contains the guest tracking token, which is otherwise never stored in plaintext. `ReplayableResponseCodec` encrypts it (AES-256-GCM, `IDEMPOTENCY_ENCRYPTION_KEY`, versioned) inside `idempotency_keys.response_body` only; the key row expires after 24 hours.

Cancellation endpoints: `POST /api/v1/me/orders/:id/cancel` (owner only, 404 otherwise), `POST /api/v1/track/:token/cancel` (token holder), `POST /api/v1/admin/orders/:id/cancel` (`orders.cancel`, reason required, audited `ORDER_CANCEL`). Staff read: `GET /api/v1/admin/orders/:id` (`orders.read.any`). Each cancellation writes history and outbox `ORDER_CANCELLED` in one transaction.

Payment expiry: the scheduler process registers the BullMQ job scheduler `payment.expiry-sweep` (every 60 s, queue `payment`); the worker runs `ExpireUnpaidOrdersService` for each run (ADR-004). The scheduler is the only trigger; the Phase 5 in-process interval is gone. It cancels `PAYMENT_PENDING` orders past `payment_expires_at` with actor `SCHEDULER`, reason `PAYMENT_EXPIRED` and outbox `ORDER_EXPIRED`, in batches of 100. The conditional update makes it safe with several schedulers and against a payment arriving at the same moment. The 60-minute default is provisional until the Duitku payment validity is fixed in Phase 6.

Order number `RBX-YYYYMMDD-NNNNN`: `order_number_counters(date PK, last_value)` incremented with `INSERT … ON CONFLICT (date) DO UPDATE SET last_value = last_value + 1 RETURNING last_value` inside the order transaction. Gap-free is not required; uniqueness is enforced by `UNIQUE(order_number)`. Date is in the business timezone (Asia/Jakarta, to confirm).

### 6.2 Payment

**Decision D-02 (product owner, 2026-10-05): Duitku is the first and primary payment gateway.** Phase 16 preserves its adapter and adds an independently configured Telegram Stars adapter.

Layering (gateway-agnostic domain, provider contracts isolated in adapters):

```text
Customer/Guest PaymentsController, PaymentMethodsController, PaymentCallbacksController   (thin HTTP)
        ↓
CreatePaymentService · PaymentQueriesService · ProcessPaymentCallbackService · VerifyPaymentService  (application)
        ↓                                  ↓
PayableOrderService (orders, exported)     PaymentGateway port (payments/domain):
                                           createPayment(), verifyCallback(), getTransactionStatus(), enabledMethods()
                                                   ↓
                                           PaymentGatewayRegistry → DuitkuPaymentGateway + TelegramStarsPaymentGateway
                                           (each adapter owns its provider endpoints, fields, validation and references)
```

`PAYMENT_GATEWAY=duitku|mock|none` selects the existing base development/Duitku adapter; `PAYMENT_PROVIDER_STARS_ENABLED=true` adds Stars alongside it. An empty configured registry means payment intake is off. Mock is development/test only. Duitku continues using its existing webhook verification; Stars uses XTR invoice quotes from immutable price/order snapshots, validates `pre_checkout_query`, and confirms only from secret-protected `successful_payment` updates. Telegram does not expose a status-by-order query in this flow, so unknown outcomes remain pending for update/reconciliation rather than triggering a blind repeat.

Endpoints (access follows the order rules: owner for customers, tracking token for guests, 404 otherwise):

| Method and path | Purpose |
|-----------------|---------|
| `GET /api/v1/payments/methods` | Enabled method codes (public) |
| `POST /api/v1/me/orders/:id/payment`, `POST /api/v1/track/:token/payment` | Open or return the order's payment attempt. Body `{ paymentMethod }` only; `Idempotency-Key` required; CSRF applies |
| `GET /api/v1/me/orders/:id/payment`, `GET /api/v1/track/:token/payment` | Latest attempt (`PaymentView`); reads our database only |
| `POST /api/v1/webhooks/payments/duitku` | Duitku callback (form encoded); no session, no CSRF; signature + verify-by-fetch |
| Telegram Bot webhook (`/api/v1/telegram/webhook`) | Handles pre-checkout and successful XTR payment updates after Telegram secret-token validation |

Payment creation:

```text
POST …/payment {paymentMethod}  + Idempotency-Key
  1. Key format (IDEMPOTENCY_KEY_REQUIRED). Order through PayableOrderService (404 if not the caller's).
  2. Known key in scope payments.create:<orderId>: same method → replay (201, Idempotent-Replayed); other → 422.
  3. Gateway on and method enabled (PAYMENT_GATEWAY_UNAVAILABLE / PAYMENT_METHOD_UNAVAILABLE).
  4. Order PAYMENT_PENDING and at least 10 minutes before its deadline (ORDER_NOT_PAYABLE).
  5. Open attempt of the order: same method and still payable → returned (200); expired/dead attempts may be closed
     according to that provider's certainty; an ambiguous Stars invoice remains pending to prevent duplicate invoices.
     Another live method → PAYMENT_ALREADY_PENDING (409).
  6. Insert payments(PENDING, amount/currency from the selected provider's settlement quote; order total and currency
     remain the IDR price snapshot,
     merchant_order_id = <order number>-<attempt n>). The partial unique index "one PENDING per order" turns a
     concurrent duplicate into PAYMENT_IN_PROGRESS (409).
  7. Gateway inquiry; the attempt closes at (order deadline − 5 min), capped by the method maximum.
     Refused → attempt FAILED, PAYMENT_GATEWAY_REJECTED (502) or PAYMENT_METHOD_UNAVAILABLE;
     unknown Duitku outcome follows the existing Duitku retry semantics; unknown Stars outcome remains PENDING
     for callback/reconciliation and does not resend automatically.
  8. One transaction: gateway reference (once known), payment URL/QR payload, expiry + idempotency row. 201 with PaymentView.
```

Callback (`ProcessPaymentCallbackService`, then `VerifyPaymentService`):

```text
Duitku → POST /api/v1/webhooks/payments/duitku (application/x-www-form-urlencoded)
  1. Optional source IP allow-list (403). Required fields and formats (400 WEBHOOK_PAYLOAD_INVALID).
     merchantCode equals ours and HMAC-SHA256(merchantCode + amount + merchantOrderId) matches, in constant
     time (401 WEBHOOK_SIGNATURE_INVALID; a REJECTED webhook_events row keyed by payload hash is kept).
  2. webhook_events(source DUITKU, event_key = merchantOrderId:reference:resultCode) ON CONFLICT DO NOTHING.
     Already PROCESSED/REJECTED → 200, nothing else. Unknown merchantOrderId → REJECTED, 200.
  3. Verify-by-fetch: Check Transaction for the merchantOrderId. Duitku does not sign resultCode or reference,
     so the callback is only a trigger. Gateway unreachable → event FAILED, 503 (Duitku redelivers).
  4. assessGatewayStatus (pure, payments/domain): reference, amount (exact decimal, callback and fetched),
     currency, then the fetched status. Any disagreement → RECONCILE; 00 → CONFIRM_PAID; 01 → pending;
     02 → attempt FAILED or EXPIRED (by its expiry).
  5. One transaction, payment row locked FOR UPDATE:
       CONFIRM_PAID: payment PAID (paid_at, reference); order PAYMENT_PENDING → PAID through the order
         transition writer (history actor PAYMENT_GATEWAY, outbox PAYMENT_CONFIRMED). Order no longer
         PAYMENT_PENDING (expired, cancelled) → payment still PAID, order untouched, reconciliation case.
         Another attempt already PAID → this one stays unpaid, reconciliation case (duplicate payment).
       RECONCILE: order PAYMENT_PENDING → RECONCILIATION_REQUIRED + reconciliation case
         (PAYMENT_AMOUNT_MISMATCH / PAYMENT_STATUS_MISMATCH). Never PAID.
       A new reconciliation case also writes outbox PAYMENT_RECONCILIATION_REQUIRED (aggregate payment).
  6. Event PROCESSED, 200.
```

Atomicity with the order: `orders/infrastructure/order-transition.writer.ts` is the single order status write path (state machine check, conditional update, history, outbox). `PrismaOrderStatusTransitionRepository.apply` and the payments repository both use it, the latter inside the payment transaction. Duplicate and concurrent callbacks serialize on the payment row lock and the conditional order update, so one payment produces one PAID transition and one `PAYMENT_CONFIRMED` event. The expiry sweep and a callback race on the conditional update: either the order is PAID, or it is CANCELLED and the money is recorded with a reconciliation case, never both (tested).

Payment expiry: the order keeps its `PAYMENT_EXPIRY_MINUTES` deadline (system setting, default 60, unchanged). Each Duitku attempt is requested with `expiryPeriod` ending 5 minutes before that deadline, so a last-minute payment is verified before the sweep cancels the order, capped by the method maximum from the Duitku table (QRIS and ShopeePay Apps 60, Jenius 10). Methods with a fixed window (LinkAja 24 min) are refused when it would not fit. Virtual accounts and retail accept the shorter window (their maximum is above 1440 minutes).

Hand-off to the queue: `PAYMENT_CONFIRMED` (aggregate `order`) and `PAYMENT_RECONCILIATION_REQUIRED` (aggregate `payment`) are written to `outbox_events` in the same transaction as the change they announce. Phase 7 relays `PAYMENT_CONFIRMED` to the `order-processing` queue (§6.3); `PAYMENT_RECONCILIATION_REQUIRED` waits for the notification consumer.

Reconciliation foundation: `VerifyPaymentService.verify({ payment, callback: null })` applies the same verify-by-fetch rules for a scheduled or staff-triggered re-check (trigger `RECONCILIATION`). It is exported but not scheduled; Duitku asks merchants not to poll Check Transaction, so any job must be sparse.

Stored on `payments`: gateway, merchant order id, Duitku reference, method code, amount, currency, status, raw status code, payment URL, expiry, paid time, callback count, last verification time. Webhook payloads are stored without the signature and without customer data (`merchantUserId`, `customerName`, `spUserHash`).

The browser return from Duitku (`DUITKU_RETURN_URL`) never changes state (PRD §13); the page reads `GET …/payment`.

### 6.3 Outbox relay

`outbox_events(id, aggregate_type, aggregate_id, event_type, payload, created_at, published_at, attempts)`.
The relay worker selects unpublished rows with `FOR UPDATE SKIP LOCKED LIMIT n`, enqueues each to BullMQ with `jobId = outbox_event.id` (BullMQ dedupes identical job ids), then sets `published_at`. A crash between enqueue and update causes a re-enqueue attempt with the same job id, which is deduplicated; consumers are idempotent anyway. Published rows are pruned after a retention period.

This removes the "DB committed but job never enqueued" gap, and is why a Redis restart cannot lose a paid order.

Implementation (ADR-004): `modules/outbox` (`RelayOutboxEventsService`, `PrismaOutboxRelayRepository`) driven by `OutboxRelayLoop` in the worker. Only event types listed in `OUTBOX_ROUTE_TABLE` (`modules/outbox/application/outbox-route-table.ts`) are relayed; others stay unpublished until their consumer exists. A failed publish increments `attempts`, stores `last_error` and stops the batch; the loop backs off up to 30 s and never gives up. Pruning of published rows is not implemented yet.

Routes and consumers (Phase 7):

| Event (aggregate) | Job (queue) | Consumer | Effect |
|-------------------|-------------|----------|--------|
| `PAYMENT_CONFIRMED` (order) | `order.payment-confirmed` (`order-processing`) | `OrderPaymentConfirmedProcessor` → `QueuePaidOrderService` | Order `PAID → QUEUED` and outbox `FULFILLMENT_REQUESTED`, one transaction |
| `FULFILLMENT_REQUESTED` (order), only when `FULFILLMENT_PROVIDER` is not `none` | `fulfillment.requested` (`fulfillment`) | `FulfillmentRequestedProcessor` → `FulfillmentEngine` (Phase 9, §6.4) | One fulfillment step per run until FULFILLED, FAILED_PERMANENTLY or RECONCILIATION_REQUIRED |

Every other event type (`ORDER_CREATED`, `ORDER_CANCELLED`, `ORDER_EXPIRED`, `PAYMENT_RECONCILIATION_REQUIRED` and the engine's `FULFILLMENT_*` progress events) has no route yet. With `FULFILLMENT_PROVIDER=none` a QUEUED order waits and its request stays in the outbox, to be delivered as a backlog once a provider is configured.

```text
payment transaction (callback, verify-by-fetch): payment PAID + order PAYMENT_PENDING → PAID
                                                 + history + outbox PAYMENT_CONFIRMED      COMMIT
        ↓ OutboxRelayLoop (worker, ≤ 1 s, FOR UPDATE SKIP LOCKED, jobId = event id)
BullMQ order-processing: order.payment-confirmed {eventId, eventType, aggregateType, aggregateId} + correlationId
        ↓ JobDispatcher → OrderPaymentConfirmedProcessor
  1. Load the outbox row by eventId; it must exist and match type PAYMENT_CONFIRMED, aggregate order and id.
     Otherwise NonRetryableJobError (a job is untrusted input; Redis is not the authority).
  2. QueuePaidOrderService: order PAID → conditional PAID → QUEUED (history actor SYSTEM, metadata outboxEventId,
     requestId = correlation id) + outbox FULFILLMENT_REQUESTED, one transaction.
       already QUEUED or further on the fulfillment path → ALREADY_QUEUED, ack, no write
       left PAID another way (REFUND_PENDING, RECONCILIATION_REQUIRED, ...) → NOT_ELIGIBLE, ack with a warning
       order missing → NonRetryableJobError
  3. Database or Redis errors propagate and are retried (5 s, 15 s, 30 s, 60 s, 5 min; 5 runs).
```

Delivery is at least once: deterministic job ids remove duplicates only while BullMQ keeps the job record, so idempotency comes from the conditional order update. Tested with the real worker: commit, rollback (no event, no job), a commit while no worker runs, Redis unreachable then back, six duplicate jobs on two workers, three workers relaying eight events, a worker killed after the effect but before acknowledging (stalled redelivery, no second effect), a forged job (fails on the first attempt and stays inspectable), and five concurrent Duitku callbacks for one payment ending in one QUEUED transition.

### 6.4a Fulfillment provider port (Phase 8)

The engine below talks to providers only through `FulfillmentProvider` (`modules/fulfillment/domain`, ADR-005), obtained from `FulfillmentProviderRegistry` by the source's `provider` code. Adapters live in `modules/fulfillment/infrastructure`; today the only one is `MockFulfillmentProvider`, a deterministic simulator for development and tests that delivers nothing.

```text
getBalance()            → AVAILABLE {robux} | UNAVAILABLE {error}
validateRecipient(r)    → VALID {robloxUserId} | INVALID | UNAVAILABLE {error}
fulfill({clientReference, recipient, robuxAmount})
                        → SUCCEEDED {providerReference, fulfilledAmount} | PARTIAL {…} | PENDING {providerReference}
                          | RETRYABLE_FAILURE {error} | PERMANENT_FAILURE {error} | UNKNOWN {error}
verify({clientReference, providerReference?})
                        → SUCCEEDED | PARTIAL | PENDING | FAILED {error} | NOT_FOUND | UNAVAILABLE {error}
errors: UNAVAILABLE, TIMEOUT, RATE_LIMITED, INVALID_RECIPIENT, INSUFFICIENT_BALANCE, DUPLICATE_REFERENCE, REJECTED, UNKNOWN
```

`clientReference` is the attempt's idempotency key (step 5 below): the same reference never delivers twice. `UNKNOWN` maps to the attempt status `UNKNOWN` in step 7 and is resolved only through `verify` (step 8). The request carries the recipient's Roblox username (and user id once resolved, Phase 11) and the amount; never customer credentials, tokens or contact data. `FULFILLMENT_PROVIDER=none|mock` selects adapters (default `none`); the mock is refused in production. The `FulfillmentModule` (engine and registry) is loaded by the worker. A real provider is added only from its official documentation, following `docs/integrations/fulfillment-provider-onboarding.md` (Phase 11 is blocked on D-01 until then).

### 6.4 Fulfillment engine

Since Phase 11 (ADR-009) the executor first resolves the order's strategy from its fulfillment-type snapshot (`fulfillment/domain/fulfillment-strategy.ts`). The strategy supplies the delivery target: the recipient, or none for digital delivery. It also says whether the provider validates that recipient. Routing uses the order's product line. Everything below applies to every fulfillment type.

Implemented in Phase 9 (`modules/fulfillment/application`, ADR-006). Since Phase 10 (ADR-007) the executor gets each request's source and amount from `FulfillmentAllocationService` (routing + reservation, §6.5): an open allocation is executed first, otherwise the remaining amount is routed and reserved; the source's provider is resolved through the registry. Attempts carry `allocation_id`. Each step's transaction also consumes delivered Robux, releases the allocation of a source that did not deliver, releases everything when the workflow ends, and updates source health. A multi-source plan is executed allocation by allocation in the same run (outcome `NEXT_ALLOCATION`, lease kept and extended).

```text
outbox FULFILLMENT_REQUESTED → relay (jobId = event id) → BullMQ fulfillment: fulfillment.requested {eventId, ...ids}
  FulfillmentRequestedProcessor: the outbox row must exist and match type, aggregate and id, else NonRetryableJobError.
  FulfillmentEngine.run(orderId, {eventId, correlationId, maxAttempts, finalRun}):
  1. acquire: order not QUEUED/RETRYING/PROCESSING/FULFILLMENT_PENDING, or not INSTANT → NOT_ELIGIBLE, ack.
     Create fulfillment_orders on first run (requested = Σ item robux × quantity; UNIQUE(order_id)).
     Take the lease: UPDATE … SET lease_token, lease_expires_at = now + 90 s WHERE lease free or expired.
     0 rows → BUSY (another run holds it) → run again after the backoff.
  2. By order status (state reloaded from PostgreSQL; the event payload is never trusted):
       QUEUED / RETRYING   → PROCESSING (FULFILLMENT_STARTED), then execute
       PROCESSING          → live attempt (EXECUTING after a crash) → verify; none → execute
       FULFILLMENT_PENDING → verify the live attempt
  3. Execute: validateRecipient (INVALID → permanent INVALID_RECIPIENT; UNAVAILABLE → retryable),
     getBalance (< remaining → retryable INSUFFICIENT_BALANCE; UNAVAILABLE → retryable),
     attempt committed as EXECUTING with client_reference FULFILLMENT-<order id>-<n>
     (reused while the previous request was not delivered), then fulfill({clientReference, recipient, robuxAmount}).
     A thrown call is UNKNOWN.
  4. Verify: verify({clientReference, providerReference}). SUCCEEDED/PARTIAL settle; PENDING/UNAVAILABLE keep waiting;
     NOT_FOUND → retry-eligible (same reference); FAILED → final.
  5. Plan + apply in ONE transaction (lease-conditional): attempt status and amounts, fulfillment order amounts,
     order transitions via writeOrderTransition, order and attempt history, outbox events, lease release.
       delivered = remaining      → … → FULFILLMENT_PENDING → FULFILLED          (FULFILLMENT_COMPLETED)
       delivered < remaining      → PARTIALLY_FULFILLED → RETRYING, remainder only (FULFILLMENT_PARTIAL, _RETRYING)
       pending / unknown          → FULFILLMENT_PENDING, verify next run          (FULFILLMENT_PENDING)
       retryable, not delivered   → FAILED → RETRYING                            (FULFILLMENT_FAILED, _RETRYING)
       permanent                  → FAILED → FAILED_PERMANENTLY                  (_FAILED, _PERMANENTLY_FAILED)
       retries used up            → … → FAILED_PERMANENTLY, stopReason RETRY_EXHAUSTED, last error kept
       still unknown on final run → FULFILLMENT_PENDING → RECONCILIATION_REQUIRED (_RECONCILIATION_REQUIRED)
  6. RETRY_SCHEDULED / AWAITING_VERIFICATION / BUSY / CONFLICT → FulfillmentContinuesError → BullMQ backoff
     (§6.6); every other outcome acknowledges the job.
```

History metadata carries `eventId`, `fulfillmentOrderId`, `attemptId`, `clientReference`, `provider`, `providerReference`, `errorCode`, `stopReason` and amounts; `request_id` is the correlation id of the payment that started it. Engine logs (`fulfillment.started`, `fulfillment.step_recorded`, `fulfillment.skipped`, `fulfillment.conflict`) carry the same identifiers; provider calls are logged once by `ObservedFulfillmentProvider`.

Execution guarantee depends on the provider: if the real provider supports a client-supplied idempotency reference, double execution is prevented at the provider too. If it does not, the "UNKNOWN → verify, never re-execute" rule is the only protection, and any unresolvable case goes to a human. Provider selection criteria therefore include idempotency support (see IMPLEMENTATION_PLAN.md, Risks).

### 6.5 Smart routing and reservation

Routing (pure function, unit-tested, implemented in Phase 10 as `SMART_V1`, ADR-007): filter sources `status=ACTIVE AND health IN (HEALTHY, DEGRADED)` whose provider this process has configured and whose balance is positive (UNKNOWN and UNAVAILABLE are never routed; the health check job brings them back), then:

**Decision D-08 (product owner, revised 2026-10-05).** Objectives, in order:

1. Source must be `ACTIVE` and healthy (`HEALTHY`/`DEGRADED`; `UNKNOWN` only if configured; `UNAVAILABLE` never without admin override).
2. Source must have available balance.
3. Prefer allocations that fully satisfy the order (a partial plan is never produced; if nothing covers it → insufficient balance).
4. Minimise the number of sources.
5. Minimise leftover fragmentation: among plans with the same number of sources, prefer the smallest surplus (sum of chosen balances − amount), i.e. best fit. Large balances stay intact for large orders.
6. Priority (lower number first, compared as a sorted list), then `cost_per_unit` if configured, then source id — tie-breakers only.

Algorithm (pure, deterministic function in `inventory/domain/routing.ts`):

- Minimum source count `k` = smallest `k` such that the `k` largest balances sum to ≥ amount.
- Enumerate `k`-combinations that cover the amount and rank them by (surplus, priority list, cost, ids). Source counts are small; enumeration has a hard cap, above which it falls back to a greedy best-fit (still minimal `k`).
- Within the chosen plan, drain the smaller balances fully and take the remainder from the largest one, which minimises the number of sources left holding dust.

| Sources (balance)                     | Need  | Plan |
|---------------------------------------|-------|------|
| A=300, B=700, C=1000                  | 1000  | **C→1000** (one source) |
| A=300, B=700, C unavailable           | 1000  | A→300, B→700 |
| A=300, B=700, C=5000                  | 1000  | C→1000 (PRD §19 showed A+B; superseded by D-08) |
| A=300, B=200, C=5000                  | 1000  | C→1000 (PRD §19 showed A+B+C; superseded) |
| C=1000, D=5000                        | 1000  | C→1000 (best fit, keeps D intact) |
| A=600 (p1), B=600 (p2), C=600 (p3)    | 1000  | A→600, B→400 (equal surplus; priority decides) |

Routing is a plan only. It is computed from a snapshot, then committed by the atomic reservation below. If any reservation in the plan fails because balances moved, the transaction rolls back and routing runs again on fresh balances (up to three rounds; then the step is a retryable `NO_ELIGIBLE_SOURCE`). Unit tests encode the D-08 table, not the PRD §19 text.

Reservation (single transaction, sources locked in ascending id order to avoid deadlocks):

```sql
UPDATE fulfillment_sources
   SET available_balance = available_balance - $amount,
       reserved_balance  = reserved_balance  + $amount
 WHERE id = $source_id
   AND status = 'ACTIVE'
   AND available_balance >= $amount
RETURNING available_balance, reserved_balance;
```

Zero rows for any allocation → roll back the whole reservation, re-read balances, re-route once, then fail as insufficient. The `CHECK (available_balance >= 0)` constraint is the last line of defence. Redis locks are not used for correctness here; PostgreSQL row locks are sufficient and survive Redis loss.

Balance sync must not overwrite reservations: `available_balance = provider_reported_balance - reserved_balance` computed inside a `SELECT … FOR UPDATE` transaction, logged to the ledger. Provider API error → keep last known balance, set `health = UNKNOWN` (PRD §78).

### 6.6 Retry policy

BullMQ backoff schedule `5s, 15s, 30s, 60s, 5m` (custom backoff strategy), max 5 automatic attempts, then `FAILED_PERMANENTLY` + alert. For fulfillment (Phase 9) this one policy is also the retry and verification schedule: the engine counts automatic retries in PostgreSQL (transitions to `RETRYING`) against the policy's maximum, and the job's final run never leaves a retry or verification waiting (`RETRY_EXHAUSTED`, or `RECONCILIATION_REQUIRED` while still unknown). Every run goes through the lease in 6.4 step 1 and the verify-first rule in step 2. Admin manual retry transitions `FAILED_PERMANENTLY → RETRYING` with an audit log entry and only retries `remaining_amount`.

### 6.7 Reconciliation

Scheduled jobs:

- **Payments:** orders `PAYMENT_PENDING` older than N minutes → query gateway. Gateway says paid → apply the same verified-payment path as the webhook. Expired → `CANCELLED`.
- **Fulfillment:** attempts in `UNKNOWN`/`VERIFYING` past deadline → `provider.verify`. Indeterminate → `RECONCILIATION_REQUIRED` + case row + alert.
- **Provider ledger:** periodic comparison of provider transaction history (if the provider exposes one) against `fulfillment_attempts`.
- **Stuck orders:** `PAID`/`QUEUED`/`RETRYING` with no live job → re-emit outbox event.

Reconciliation never guesses. Every automated resolution writes the evidence it used.

### 6.8 Queues

| Queue              | Producers                | Consumers / purpose                          |
|--------------------|--------------------------|----------------------------------------------|
| `order-processing` | outbox relay             | PAID → QUEUED, enqueue fulfillment           |
| `fulfillment`      | order-processing, retry  | execute + verify (`order.requested`, `order.retry`, `order.remaining`, `attempt.verify`) |
| `payment`          | scheduler, webhook       | payment status follow-up, expiry             |
| `webhook`          | webhooks controller      | process persisted webhook events             |
| `notification`     | outbox relay             | Telegram, Discord, email, in-app             |
| `inventory-sync`   | scheduler, admin         | balance sync, health checks, low-balance     |
| `reconciliation`   | scheduler                | 6.7                                          |

Jobs carry ids only (order id, event id). Workers read current state from PostgreSQL. Job payloads never contain secrets or customer credentials.

Only queues with a job exist in code (`common/queue/queue-catalog.ts`); today that is `payment` (`payment.expiry-sweep`, scheduler), `order-processing` (`order.payment-confirmed`, outbox relay, concurrency 5) and `fulfillment` (`fulfillment.requested`, outbox relay, concurrency 5; Phase 9) and `inventory-sync` (`inventory.source-health-check`, scheduler every minute, concurrency 1; Phase 10). The others are added with their first job. Queue abstraction, retry policy, payload rules and shutdown behaviour: ADR-004.

---

## 7. Frontend architecture

- Next.js App Router, TypeScript, Tailwind, shadcn/ui, Framer Motion (restrained, `prefers-reduced-motion` respected).
- Server Components fetch from the API over the internal network (`http://api:4000`), forwarding the visitor session cookie and IP (`X-Real-IP` becomes `X-Forwarded-For`) so per-client rate limits apply to the visitor. Browser mutations call same-origin `/api/v1/...` with the CSRF header (`src/lib/api/browser-api.ts`).
- i18n-ready from Phase 1 (D-09): all UI strings live in message catalogs (`messages/id.json`), accessed through `next-intl`; default and only shipped locale is Bahasa Indonesia (`id`). English is added later by adding `messages/en.json`. No hard-coded user-facing strings in components.
- Every API interaction has `idle / loading / success / error` states (PRD §58). Error messages come from application error codes mapped to customer copy; raw errors are never rendered.
- Routes: `/`, `/products`, `/checkout`, `/order/[token]` (guest tracking), `/login`, `/register`, `/account`, `/account/orders`, `/account/orders/[id]`, and the staff console `/console/**`.
- Staff console (`app/console`, `features/console`): `/console` dashboard, `/console/orders[/id]`, `/console/products[/id]`, `/console/pricing`, `/console/inventory`, `/console/security`, sign-in at `/console/login`. The `(workspace)` layout asks the API for `/admin/me` once per request and redirects anyone it refuses to the sign-in; the API still authorizes every call. Legacy `/admin/*` page URLs redirect permanently (308) to `/console/*`; the API namespace `/api/v1/admin/*` is unchanged. Console pages are `noindex`. Only screens with a backend are in the navigation (`features/console/navigation.ts`); payments, fulfillment, customers, staff, notifications, audit and settings are added in their phases. Metrics without an API (revenue, payment counts, fulfillment rate, order list) render an explicit "not available" state, never estimated numbers.
- Console typography is Poppins, self-hosted by `next/font` and applied once by `app/console/layout.tsx` through the `--font-console` token; the storefront keeps the system font stack.
- Design system (one implementation per pattern; the binding standard is ENGINEERING_STANDARDS.md §4.4):
  - `components/ui`: Button, ButtonLink and IconButton (variants primary / secondary / outline / ghost / danger / link); Icon, the only Iconsax import; Dialog, the single native `<dialog>` overlay, with FormDialog for create/edit, ConfirmDialog, and the mobile navigation drawer; DropdownMenu; CopyButton.
  - `components/forms`: FormField with label, hint, required and error wiring; TextField, SelectField, TextareaField, PasswordField.
  - `components/data-display`: DataTable with a "No." column, page-size select, pagination, loading, error and empty states, and an optional phone card layout; Pagination; PageSizeSelect; StatusBadge with the tones success / progress / attention / danger / neutral / info; StatCard.
  - `components/feedback`: Alert, ApiErrorAlert, EmptyState, Skeleton, Toast.
  - `components/layout`: PageHeader, Breadcrumb, Panel.
  - Feature badges (order, payment, stage, product, price version) only map their statuses to StatusBadge tones.
- Console theme: Light, Dark (default) and System on semantic tokens (`globals.css`). The choice is kept in the `console-theme` cookie and read on the server, so the first paint already has the right theme.
- Console CRUD runs in dialogs: product create, edit and status, and new price (edit, then review). Server pages render data; client tables page lists that the API returns whole, while orders are paged by the API through URL parameters.
- Order tracking page polls (or uses SSE) the public order status endpoint; admin monitor uses SSE or short polling (decide in Phase 13, measured).
- Design tokens from PRD §55 defined once as CSS variables, consumed by Tailwind theme. Mobile-first, checkout tested at 360px width.

---

## 8. Failure handling summary

| Failure                                    | Behaviour |
|--------------------------------------------|-----------|
| Duplicate order request                    | Idempotency key returns original result. |
| Duplicate payment webhook                  | `UNIQUE(provider, event_id)`; conditional state update. Second is a no-op. |
| Webhook arrives before order commit        | Persisted event processed by queue with retry; order lookup retried. |
| Payment amount/currency mismatch           | `RECONCILIATION_REQUIRED`, alert, no fulfillment. |
| Provider timeout                           | Attempt `UNKNOWN` → verify, never blind retry. |
| Provider 200 but not delivered             | Order stays `FULFILLMENT_PENDING` until verified. |
| Partial delivery                           | Consume delivered part, release the rest, retry remaining only. |
| Worker crash mid-job                       | BullMQ stalled-job recovery re-delivers; claim + attempt state decide what is safe. |
| Redis restart / data loss                  | Outbox and DB state survive; scheduler sweep re-enqueues stuck orders. |
| PostgreSQL restart                         | Apps fail readiness, retry connections; jobs fail and retry with backoff. |
| Insufficient inventory                     | Retryable failure + LOW_BALANCE alert; product shows OUT OF STOCK. |
| Notification channel down                  | Notification job retries independently; order processing unaffected. |
| Concurrent reservations                    | Conditional atomic update + CHECK constraint; no oversell. |

---

## 9. Observability

Application-level, no dependency on PM2 or any process-manager monitoring.

- Logging: `pino` via `nestjs-pino` (API) and plain `pino` (worker, scheduler), JSON to stdout, collected by Docker's log driver with rotation. Nginx access logs in JSON with the same request id. Fields: `timestamp, level, service, requestId, userId, orderId, paymentId, jobId, queue, attemptId, providerReference, event, status, errorCode, errorClass, durationMs`. Redaction list in `common/logging/redact.ts` (authorization, cookie, password, token, secret, apiKey, totp, credential, signature).
- Correlation chain: Nginx sets/forwards `X-Request-Id` → API logs it and stores it on `order_status_history`, `outbox_events` and job data → worker logs carry the same `requestId` plus `jobId`, `attemptId` and `providerReference`. One query on `requestId` or `orderId` reconstructs customer → order → payment → queue job → worker → fulfillment attempt → provider reference.
- Error classification: every caught error maps to an application error code and a class (`VALIDATION`, `BUSINESS_RULE`, `PROVIDER_RETRYABLE`, `PROVIDER_PERMANENT`, `PROVIDER_UNKNOWN`, `INFRASTRUCTURE`, `BUG`) used in logs, metrics labels and retry decisions.
- Health: `api` exposes `/health`, `/health/live`, `/health/ready` (PostgreSQL, Redis, queue reachable; provider status reported but not gating readiness, to avoid taking the API down when one provider is degraded). `worker`/`scheduler` expose container-local health endpoints including a heartbeat (a 5 s timer; stale after 30 s means the event loop is blocked). Readiness checks PostgreSQL and Redis with a 2 s timeout each. Fatal errors (`uncaughtException`, `unhandledRejection`) log and exit non-zero, so Docker's restart policy replaces the process. Note: plain Docker Compose marks a container `unhealthy` but does **not** restart it; a hung-but-alive process therefore stays visible as `unhealthy` until an operator or alert acts. An automatic remedy (in-process watchdog or an autoheal sidecar) is a Phase 15 decision.
- Metrics: `prom-client`, exposed on an internal-only port. Metrics from master prompt §41. Prometheus/Grafana optional Compose profile.
- Errors: Sentry optional (`SENTRY_DSN`), with the same redaction applied via `beforeSend`.

---

## 10. Scalability path

## 11. Telegram product fulfillment (Phase 12)

The catalog contains fixed Telegram Premium duration variants, fixed Stars quantities, and a Telegram Account product, all using versioned server-authoritative prices. Product line snapshots select the Phase 11 fulfillment type: Premium/Stars use `RECIPIENT_FULFILLMENT`, and Account uses `DIGITAL_DELIVERY`. Checkout asks for a Telegram username only when the product configuration requires a recipient; the API remains authoritative.

Premium and Stars flow through the existing outbox, worker, fulfillment engine, provider registry, idempotency, retry and verification behavior. Their configured provider remains the deterministic development mock (**MOCK / NOT PRODUCTION SUPPLIER**); no Telegram supplier integration exists.

Telegram Account inventory is represented by `DigitalInventoryItem`, attached to the existing product and fulfillment source. Its payload is encrypted with AES-256-GCM under an API-only `ACCOUNT_INVENTORY_ENCRYPTION_KEY`; the key never enters the database. Source reservation and item selection occur in the same PostgreSQL transaction. Consumption marks an account sold, release makes unconsumed stock available, and explicit post-fulfillment handoff marks it delivered. Normal order and inventory projections never include ciphertext or credentials. Guest handoff uses the private tracking token in a rate-limited POST body, while signed-in handoff checks order ownership.

The current handoff provides explicit one-click reveal and audit events. It does not implement Telegram sourcing, supplier automation, customer account recovery, or a transfer verification process. See [ADR-010](ADR/ADR-010-telegram-account-inventory-and-handoff.md).

## 13. Telegram sales channel and provider capability gate (Phase 13)

The Telegram Bot API can technically serve as a customer channel, but sales of digital goods inside bots and mini apps must use Telegram Stars under the [Bot Developer Terms](https://telegram.org/tos/bot-developers) and [Stars payment guidance](https://core.telegram.org/bots/payments-stars). The existing Duitku checkout must not be reused for digital purchases initiated and sold inside the bot. Any future bot checkout must represent Telegram Stars payment through the existing Core order/payment state transitions; the bot remains a client and must never mark an order paid itself.

The official Bot API documents `giftPremiumSubscription` for 3, 6, or 12 months, paid from the bot's Stars balance. It requires the recipient's numeric Telegram user ID and has no documented request idempotency key. Phase 12's 1-month product cannot use this method. A timeout must be treated as unknown and reconciled from transaction evidence where possible, never blindly retried. This documents a capability, not a confirmed commercial reseller agreement. See [ADR-011](ADR/ADR-011-telegram-bot-commerce-payment-boundary.md) and [Phase 13 provider research](PHASE-13-PROVIDER-RESEARCH.md).

The official Bot API does not document a method for crediting another user's Telegram Stars balance. Telegram Account sourcing/provisioning likewise has no verified authorized supplier/API in this audit. Those integrations remain disabled pending a documented, commercially authorized mechanism. The Phase 12 mock remains development/test-only and must never be selected as a production fallback.

If a bot is later approved, it should use the Core catalog, checkout, payment, order, handoff, and fulfillment APIs over the private network. Production delivery should use Telegram webhooks through Nginx with Telegram's webhook secret token, update-ID deduplication, callback authorization against Core state, and no public bot port. A bot must not hold a duplicate catalog, order, payment, inventory, or fulfillment system. No bot service or webhook route is implemented in Phase 13.

## 14. Telegram Account storefront readiness (Phase 14 audit)

The Phase 14 business priority is Telegram Accounts already held in Core inventory. The existing Digital Fulfillment Core has account products, versioned prices, encrypted inventory payloads, source-ledger stock counts, transactional item reservation/release/sale, queue-driven fulfillment, and an ownership-checked guest/customer handoff. A storefront should reuse these capabilities and must not create a second order or inventory system. See [Phase 14 gap analysis](PHASE-14-GAP-ANALYSIS.md) and [Telegram Account Bot design](PHASE-14-TELEGRAM-ACCOUNT-BOT.md).

**PREVIOUS ASSUMPTION DOES NOT MATCH CURRENT BUSINESS PRIORITY:** Phase 13 deferred the first bot around Premium/Stars recipient fulfillment and XTR checkout. That was the prior phase's scope; Phase 14 is now account-first. Premium and Stars provider work and numeric recipient resolution are not prerequisites for account delivery.

An account is a digital product. The accepted [ADR-011](ADR/ADR-011-telegram-bot-commerce-payment-boundary.md) records Telegram's Bot Developer Terms requiring Stars for digital goods sold inside bots/mini apps and prohibits offering Core digital products for in-bot purchase through Duitku absent a verified exception. The Phase 16 registry permits both methods at the Core layer for applicable channels; the Telegram production controller continues to expose and accept Stars only. Stars production stays disabled without explicit configuration, a product quote and authorization gate. Do not treat a payment URL opened from the bot as a policy exemption.

The bot must not reveal account payloads in chat, callbacks, URLs, logs, or ordinary tracking. It may expose a protected Core handoff only after payment confirmation, successful fulfillment, and owner authorization. Account sourcing, creation, login automation, and transfer validation are outside this architecture and remain unimplemented.

## 15. Telegram Account payment feasibility (Phase 15)

Duitku's documented merchant response may include a QRIS `qrString`. Phase 16 preserves a bounded QR payload for configured QRIS methods and exposes it only on the paying order's active payment view; non-QR methods discard it. The Mini App does not yet render the payload into a scannable QR image; it still has the existing Duitku payment URL.

Technical QR support does not make third-party QRIS an acceptable payment rail for an in-bot digital Account sale. Telegram Bot Developer Terms §6.2 require Stars for digital goods/services sold in bots. An account is strongly indicated to be a digital/virtual product, though the terms do not explicitly name account resale; production classification and resale permission must be confirmed. Do not offer Duitku QRIS inside this bot unless a documented, applicable authorization or legal determination changes the rule. Midtrans/Xendit QRIS do not alter this boundary.

The in-Telegram candidate is a Stars invoice (`XTR`). Phase 16 adds explicit XTR price fields, pre-checkout validation, successful-payment update verification and charge-event deduplication through Core. It does not derive XTR from IDR or implement Stars refunds. See [Phase 15 Payment Feasibility](PHASE-15-PAYMENT-FEASIBILITY.md) and [Phase 16](PHASE-16-MULTI-PAYMENT-TON-TREASURY.md). Until Telegram account-sale and payment authorization are verified, production checkout remains gated.

### 15.1 Telegram Mini App technical MVP (implementation sprint)

The Core API exposes `/api/v1/telegram/miniapp/*` for a Telegram-authenticated account storefront. Mini App requests present Telegram Web App `initData` in an `Authorization: tma ...` header; the API verifies Telegram's HMAC and freshness before upserting the numeric Telegram user identity. Orders are Core `Order` rows with a minimal `telegram_orders` ownership link; product, price, payment, inventory and fulfillment are not duplicated. The bot webhook is hosted by the API under `/api/v1/telegram/webhook`, validates `X-Telegram-Bot-Api-Secret-Token`, and persists update IDs to ignore webhook replays. Bot commands use Telegram's Web App button to open the Next.js `/telegram-store` route.

Development Compose selects a local mock payment gateway (`MK` method). It starts pending and can be settled only through an owner-authenticated development endpoint. Settlement goes through the existing callback parser, authoritative status lookup, payment verifier, payment state transition and outbox; production startup rejects this adapter. The existing worker queue routes `PAYMENT_CONFIRMED` and `FULFILLMENT_COMPLETED` notifications, and fulfillment still uses the existing worker, reservation ledger and inventory handoff. The Mini App receives secrets only from the existing owner-checked handoff route after fulfillment; secrets remain in component memory and are not persisted by the browser.

Telegram Account storefront supports configured Core methods in non-production. Production Telegram checkout remains Stars-only and behind the Stars authorization gate. The Mini App QR renderer, real TON funding, and treasury execution are not implemented.

## 12. Scalability path

Initial: 1 × each container on one host. Next steps, in order, when measurements justify them:

1. `--scale worker=N` (claims and job ids already make concurrent workers safe).
2. Separate fulfillment worker pool from notification/sync workers (same image, different `WORKER_QUEUES` env).
3. Multiple `api` replicas behind Nginx (stateless; sessions in PostgreSQL).
4. Managed PostgreSQL with PITR; managed Redis.
5. Read replica for admin analytics.

The only singleton concern is the scheduler, and BullMQ job schedulers are idempotent upserts, so even two schedulers would not double-schedule.
