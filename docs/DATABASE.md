# Database

**Status:** Phase 2 design, implemented in `apps/api/prisma/`.
**Engine:** PostgreSQL 17 (source of truth). **Schema/migrations:** Prisma 7 (multi-file schema in `apps/api/prisma/schema/`).
**Related:** `ARCHITECTURE.md` §5–§6, `SECURITY.md`, `ENGINEERING_STANDARDS.md`.

---

## 1. Conventions

| Concern | Rule |
|---------|------|
| Primary keys | UUID v7 (`@default(uuid(7))`, PostgreSQL `uuid`). Time-ordered, never exposed as public identifiers for orders. |
| Names | Tables snake_case plural (`order_items`), columns snake_case. Prisma models/fields are PascalCase/camelCase with `@@map`/`@map`. |
| Timestamps | `timestamptz(3)`. `created_at` on every table; `updated_at` only on mutable rows. |
| Enums | PostgreSQL enums for closed sets (statuses, roles, reasons). Adding a value is a migration, on purpose. |
| Money | `NUMERIC(18,2)` (`Decimal`), currency column of enum `currency` (§3). Never float. |
| Robux and quantities | `INTEGER` per order line and attempt; `BIGINT` for source balances and ledger. |
| JSON | `jsonb` only for genuinely open-ended data (audit before/after, provider evidence, redacted webhook payloads, settings values). Never for fields that are queried or constrained. |
| Soft delete | Only `products.archived_at` (a product referenced by orders cannot be deleted but must be hidden). Transactional records are never deleted. |

---

## 2. Tables by domain (31)

The PRD's 18 core tables (§27/§44) plus 8 supporting tables. Supporting tables are marked †.

| Domain | Tables |
|--------|--------|
| Identity | `users`, `user_sessions`, `admin_2fa`, `admin_recovery_codes` †, `login_attempts` † |
| Telegram identity | `telegram_identities`, `telegram_orders`, `telegram_bot_updates` † |
| Catalog / pricing | `products`, `product_prices` |
| Orders | `orders`, `order_items`, `order_status_history` †, `order_number_counters` †, `idempotency_keys` † |
| Payments | `payments`, `webhook_events` |
| Fulfillment | `fulfillment_orders`, `fulfillment_attempts`, `fulfillment_attempt_status_history` †, `fulfillment_allocations` |
| Inventory | `fulfillment_sources`, `source_balance_logs` |
| Gamepass | `gamepass_orders` |
| Messaging | `outbox_events`, `notifications` |
| Administration / audit | `audit_logs`, `reconciliation_cases` †, `system_settings` † |
| Supplier treasury | `treasury_transactions` † |

Not tables:

- **Guest tracking token** is a column (`orders.tracking_token_hash`), not a table: exactly one token per order.
- **Payment status history** is not a separate table: every gateway notification is a `webhook_events` row, and `payments` keeps `paid_at`, `last_verified_at` and `raw_status`. Order-level payment transitions land in `order_status_history`.
- **Fulfillment order status history**: the fulfillment order's lifecycle mirrors the order (`QUEUED → PROCESSING → FULFILLMENT_PENDING → FULFILLED`) and is recorded in `order_status_history`. The fine-grained, uncertain part (attempt `EXECUTING → VERIFYING → UNKNOWN → SUCCEEDED`) is recorded in `fulfillment_attempt_status_history`.

---

## 3. Money and currency

- Product prices and order totals remain **IDR** (`enum currency { IDR }`). Payment attempts use a separate `payment_currency` enum (`IDR`, `XTR`) so Telegram Stars settlement does not mutate the IDR order snapshot.
- Storage: `NUMERIC(18,2)` so the schema does not need to change for currencies with cents. **IDR amounts are whole rupiah**: a CHECK constraint enforces `amount = trunc(amount)` when `currency = 'IDR'` on every IDR money column that customers pay (`product_prices.selling_price`, order totals, order item prices, payment amounts). XTR invoices are explicit integer Stars; `product_prices.stars_amount` and `order_items.stars_amount_snapshot` preserve the independent quote.
- Costs: `product_prices.cost_price` and snapshots are also whole rupiah. Per-Robux source costs (`fulfillment_sources.cost_per_unit`, `fulfillment_allocations.unit_cost_snapshot`) are `NUMERIC(18,4)` because a per-unit cost such as 95.5 IDR/Robux is legitimate; totals derived from them are rounded when stored as money.
- Rounding: **half-up to the currency's minor unit (0 decimals for IDR), applied once per stored amount**, never on intermediate values. Implemented by the pricing domain (Phase 4) with `decimal.js`; the database CHECKs reject anything that slipped through.
- Arithmetic invariants enforced by CHECK:
  - `order_items.line_subtotal = unit_price_snapshot * quantity`
  - `orders.total = subtotal - discount + fee + tax`, all ≥ 0, `discount <= subtotal` (Phase 5)
- API representation: decimal strings (`"69000.00"`), never JSON numbers.

---

## 4. Pricing versioning

```text
products (identity, robux amount, method, limits, active)      — mutable
   └── product_prices (version N, selling, cost, effective_from) — append-only
          └── order_items.product_price_id + price/cost/name snapshots — frozen at checkout
```

- `product_prices` rows are **immutable** (UPDATE/DELETE blocked by trigger). A price change inserts a new row with `version = previous + 1` (`UNIQUE(product_id, version)`).
- The active price is the row with the greatest `effective_from <= now()` for the product (ties: higher version).
- Creating a product inserts price version 1 in the same transaction (the products repository writes both rows), so no product exists without a price. All later versions go through `PriceVersionService`.
- `order_items` stores `unit_price_snapshot`, `unit_cost_snapshot`, `product_name_snapshot`, `robux_amount` and a `RESTRICT` foreign key to the exact `product_prices` row used. Orders never join back to "current price" for financial values.

---

## 5. Identifiers

| Identifier | Column | Purpose | Properties |
|------------|--------|---------|------------|
| Internal id | `orders.id` | Joins, foreign keys | UUID v7; never used as a public access key |
| Order number | `orders.order_number` | Human reference for support, receipts | `RBX-YYYYMMDD-NNNNN`, `UNIQUE`, CHECK format; sequential per day (Asia/Jakarta) via `order_number_counters`; **not** an access credential |
| Guest tracking token | `orders.tracking_token_hash` | Access to `/order/{token}` without an account | 256-bit CSPRNG, base64url (43 chars), only SHA-256 hex stored, `UNIQUE`, CHECK `^[0-9a-f]{64}$` |
| Gateway merchant reference | `payments.merchant_order_id` | Our reference sent to Duitku | `UNIQUE` |
| Provider client reference | `fulfillment_attempts.client_reference` | Idempotency key sent to the fulfillment provider | `FULFILLMENT-<order id>-<n>`, shared by retries of an undelivered request; partial `UNIQUE` over delivered attempts (Phase 9, ADR-006) |

---

## 5a. Product lines (Phase 11, ADR-009)

Migration `20261006010000_digital_fulfillment_core` (additive):

- New enums `product_line`, `platform`, `fulfillment_type`, `recipient_type`.
- `products.product_line` (default `ROBLOX_ROBUX`); CHECK `products_gamepass_is_robux`.
- `fulfillment_sources.product_line` (default `ROBLOX_ROBUX`), index `(product_line, status, health)` for per-line routing and availability.
- `orders.product_line`, `platform`, `fulfillment_type`, `recipient_type` (defaults are the Robux values, so existing rows keep their meaning); `orders.recipient_username` nullable.
- CHECKs on `orders`:
  - `orders_product_line_consistent`: the line, platform and type form one of the four valid combinations.
  - `orders_recipient_matches_type`: digital delivery has no recipient; every other type has a recipient of the platform's kind.
  - `orders_roblox_user_id_only_for_roblox`
  - `orders_gamepass_is_robux`

## 6. Status history

- `order_status_history`: one row per order transition, including the initial `NULL → CREATED`. Columns: `from_status`, `to_status`, `actor_type` (`SYSTEM`, `CUSTOMER`, `STAFF`, `PAYMENT_GATEWAY`, `FULFILLMENT_PROVIDER`, `SCHEDULER`), `actor_user_id`, `reason`, `metadata jsonb`, `request_id`, `created_at`.
- `fulfillment_attempt_status_history`: same shape for attempts.
- Both are append-only (trigger). Rows are written in the same transaction as the status change by the owning repository, which performs a conditional update (`WHERE status = expected`) so two concurrent writers cannot both record a transition.

---

## 7. Idempotency guarantees (database level)

| Operation | Final guarantee |
|-----------|-----------------|
| Order creation | `orders.idempotency_key UNIQUE`; replay data in `idempotency_keys` `UNIQUE(scope, key)` with `request_hash` |
| Payment callback | `webhook_events UNIQUE(source, event_key)` |
| Gateway reference | `payments UNIQUE(gateway, gateway_reference)`; `payments.merchant_order_id UNIQUE` |
| One successful payment per order | partial `UNIQUE(order_id) WHERE status = 'PAID'` |
| One live payment attempt per order | partial `UNIQUE(order_id) WHERE status = 'PENDING'` (Phase 6) |
| Payment creation retry | `idempotency_keys` row in scope `payments.create:<order id>` (Phase 6) |
| One fulfillment per order | `fulfillment_orders.order_id UNIQUE` |
| Attempt numbering | `UNIQUE(fulfillment_order_id, attempt_number)` |
| Provider idempotency | partial `UNIQUE(client_reference) WHERE status IN ('SUCCEEDED','PARTIAL')` (one delivery per reference), `UNIQUE(provider, external_reference)` |
| One live attempt per fulfillment order | partial `UNIQUE(fulfillment_order_id) WHERE status IN ('PENDING','EXECUTING','VERIFYING','UNKNOWN')` (Phase 9) |
| One workflow run per order | `fulfillment_orders.lease_token` / `lease_expires_at` taken by conditional update; CHECK both NULL or both set (Phase 9) |
| No double reservation per workflow | reservation requires no `RESERVED` allocation for the fulfillment order, under the order's lease row lock (Phase 10) |
| Notification delivery | `notifications UNIQUE(outbox_event_id, channel, recipient)` |
| Gamepass flow per order | `gamepass_orders.order_id UNIQUE` |
| One open reconciliation case per order and kind | partial `UNIQUE(order_id, kind) WHERE status = 'OPEN'` |

Application checks (`if exists`) are for friendly errors only; the constraint is the guarantee.

---

## 8. Inventory and concurrency strategy

Balances live on `fulfillment_sources`:

```text
available_balance  ≥ 0   (CHECK)
reserved_balance   ≥ 0   (CHECK)
```

Allocation lifecycle on `fulfillment_allocations`: `RESERVED → CONSUMED | RELEASED`, with `consumed_amount + released_amount = amount` once terminal (CHECK), `released_amount = 0` and `consumed_amount < amount` while `RESERVED` (CHECK, Phase 10), and `consumed_amount + released_amount <= amount` always. Partial delivery (Phase 10, ADR-007): consume `m` and keep the rest reserved for the same source while the remainder is still expected; when the workflow ends or the source fails, release `amount - consumed` and settle (`CONSUMED` if anything was consumed, else `RELEASED`).

Transaction pattern (implemented in Phase 10, `inventory/infrastructure/inventory-ledger.writer.ts`, inside the fulfillment step's transaction):

1. Reserve (one transaction, sources touched in ascending id order to avoid deadlocks):
   ```sql
   UPDATE fulfillment_sources
      SET available_balance = available_balance - $n, reserved_balance = reserved_balance + $n
    WHERE id = $source AND status = 'ACTIVE' AND available_balance >= $n
   RETURNING available_balance, reserved_balance;
   ```
   Zero rows → roll back the whole reservation. Then insert `fulfillment_allocations (RESERVED)` and a `source_balance_logs` row.
2. Consume / release: conditional update of the allocation (`WHERE status = 'RESERVED'`) first; only if one row changed, move the balance (`reserved -= n`, and for release `available += n`) and log it. A second consume/release of the same allocation changes zero rows and does nothing.
3. The CHECK constraints are the last line of defence: no code path can make a balance negative.
4. Low balance (Phase 10): after a reservation or adjustment, `UPDATE … SET low_balance_since = now() WHERE low_balance_since IS NULL AND available_balance < low_balance_threshold` — only the update that crosses writes the `SOURCE_LOW_BALANCE` outbox event; after a release or adjustment a matching conditional update clears the mark when the balance is back.
5. No time-based expiry of reservations: an open allocation belongs to a workflow that its job continues (a crashed run's lease expires and the next run resumes it); allocations of `RECONCILIATION_REQUIRED` orders stay reserved until a person decides.

Phase 10 columns and constraints: `fulfillment_sources.low_balance_since`, `consecutive_failures` (CHECK ≥ 0); `fulfillment_allocations.routing_strategy`, `routing_decision` (JSONB), `unit_cost_snapshot` nullable, CHECK `fulfillment_allocations_settled_within_amount`; `fulfillment_attempts.allocation_id` indexed (`fulfillment_attempts_allocation_id_idx`) instead of unique, because retries and the remainder of a partial delivery execute the same allocation (migration `20261005100000_inventory_routing`). Routing reads all sources (a small table) by `fulfillment_sources(status, health, priority)`; open allocations are found by `fulfillment_allocations(fulfillment_order_id)`; no index was added for the low-balance state, which is read only with the full source list.

PostgreSQL row locks taken by these `UPDATE`s are sufficient; Redis locks are not used for correctness. Isolation level: READ COMMITTED (default) is correct for conditional single-row updates; multi-step reads that decide routing re-validate through the conditional update.

---

## 9. Append-only tables

A trigger function `forbid_row_mutation()` raises on `UPDATE` and `DELETE` for:
`product_prices`, `order_status_history`, `fulfillment_attempt_status_history`, `source_balance_logs`, `audit_logs`.

Planned hardening (Phase 16): a separate application database role without DDL and without `TRUNCATE` on these tables, so the application cannot drop the triggers either.

---

## 10. Delete behaviour

Default is `RESTRICT`: history is preserved and accidental deletes fail loudly.

| Relationship | ON DELETE | Reason |
|--------------|-----------|--------|
| `user_sessions.user_id`, `admin_2fa.user_id`, `admin_recovery_codes.user_id` | CASCADE | Credentials/session material of a user have no value without the user and must not outlive it |
| `login_attempts.user_id` | SET NULL | Security log survives; link is optional |
| Everything referencing `orders`, `payments`, `products`, `product_prices`, `fulfillment_*`, `fulfillment_sources` | RESTRICT | Financial and fulfillment history must stay intact |
| `orders.user_id`, actor/creator references to `users` | RESTRICT | Users are disabled, never deleted, while they own history |
| `notifications.outbox_event_id` | SET NULL | Outbox rows are pruned after publication; delivery records remain |

---

## 11. Indexes (by query)

| Query | Index |
|-------|-------|
| Order by number / tracking token / idempotency key | unique indexes on each |
| Customer order history | `orders(user_id, created_at DESC)` |
| Order monitor, stuck-order sweeps | `orders(status, updated_at)` |
| Guest order lookup by email (claiming orders) | `orders(contact_email)` |
| Order timeline | `order_status_history(order_id, created_at)` |
| Payment by gateway reference | unique `(gateway, gateway_reference)` |
| Payment expiry / reconciliation sweeps | `payments(status, expires_at)` |
| Payments of an order | `payments(order_id)` |
| Webhook processing queue | `webhook_events(status, received_at)` |
| Fulfillment by status | `fulfillment_orders(status, updated_at)` |
| Attempts needing verification | `fulfillment_attempts(status, verify_deadline_at)` |
| Allocations per source | `fulfillment_allocations(source_id, status)` |
| Routing candidates | `fulfillment_sources(status, health, priority)` |
| Source ledger | `source_balance_logs(source_id, created_at)` |
| Outbox relay | `outbox_events(published_at, created_at)` |
| Audit by resource / actor | `audit_logs(resource_type, resource_id, created_at)`, `audit_logs(actor_user_id, created_at)` |
| Active price | `UNIQUE product_prices(product_id, version)`, `product_prices(product_id, effective_from DESC)` |
| Sessions | unique `token_hash`, `(user_id)`, `(expires_at)` |
| Login throttling | `login_attempts(email_hash, created_at)`, `login_attempts(ip, created_at)` |
| Idempotency cleanup | `idempotency_keys(expires_at)` |

Foreign-key columns used in joins are indexed where the table is expected to grow; small or unique-keyed relations rely on their unique index.

---

## 12. Migrations

- Generated from the schema with Prisma, reviewed as SQL, committed under `apps/api/prisma/migrations/<timestamp>_<name>/`.
- Constraints Prisma cannot express (CHECKs, triggers) live in hand-written migrations next to the generated ones. `prisma migrate diff` against a migrated database must report no drift (verified in CI by the integration suite).
- Partial unique indexes use Prisma's `partialIndexes` preview feature so they stay in the schema rather than as drift-prone raw SQL. Risk accepted: preview syntax may change in a Prisma upgrade.
- Production applies migrations only through the one-shot `migrate` container (`prisma migrate deploy`). No manual DDL.
- `20261005030000_order_tax_payment_deadline_pending_recipient` (Phase 5, additive, no data rewrite): adds `orders.tax` (default 0) and `orders.payment_expires_at`, makes `orders.recipient_roblox_user_id` nullable (the Roblox user id is resolved in Phase 11; until then the username identifies the account), adds the index `(status, payment_expires_at)` for the expiry sweep, rewrites the order amount CHECKs to include tax and `discount <= subtotal`, and adds `orders_payment_deadline_after_creation`. Down path: drop the new CHECK and index, restore the previous CHECKs, set NOT NULL on `recipient_roblox_user_id` only after every row has a value, drop the two columns.
- `20261005060000_payment_attempts` (Phase 6, additive, `payments` had no rows): partial unique index `payments_one_pending_per_order` (one live attempt per order, so concurrent payment requests cannot open two payable gateway transactions) and CHECK `payments_paid_has_reference` (a PAID payment carries the gateway reference it was verified against). Down path: drop the index and the CHECK.
- `20261010100000_multi_payment_treasury` (Phase 16, additive): adds `TELEGRAM_STARS`, a separate payment settlement currency, optional Stars quote/snapshot, bounded `payments.qr_payload`, and treasury transaction ledger. Existing IDR rows are cast by enum label and retained. The old IDR whole-amount CHECK is dropped before the column type change and recreated afterward. Prisma has no down migration; preserve these additive enum/table/column changes during application rollback and do not write Stars rows with an older application version.
- Down migrations: Prisma has none. Each migration's `down` path is documented in its header when it is not a plain drop; destructive changes follow expand/contract over two releases.

---

## 13. Seed data

- `apps/api/src/seed/` (compiled to `dist/seed/run-seed.js`), run with `prisma db seed` locally or `node dist/seed/run-seed.js` in the container.
- Deterministic: fixed UUIDs and upserts, safe to run repeatedly. Refuses to run when `NODE_ENV=production`.
- Contents: PRD §3 products (500/1,000/2,000 active, 80 active, 5,000 inactive) with placeholder IDR prices, three mock fulfillment sources (balances from PRD §18), default `system_settings`. No users, no credentials, no personal data. The staff account seed arrives with authentication in Phase 3.
