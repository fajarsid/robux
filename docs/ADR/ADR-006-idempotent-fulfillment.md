# ADR-006: Idempotent fulfillment engine

**Status:** Accepted (Phase 9)
**Related:** ARCHITECTURE.md §5.3, §5.4, §6.3, §6.4, §6.6; ADR-004 (BullMQ and outbox); ADR-005 (provider port); SECURITY.md §6 (R-01)

## Context

Phase 7 leaves paid orders `QUEUED` with a `FULFILLMENT_REQUESTED` outbox event. Phase 9 adds the engine that delivers the Robux through the provider port (ADR-005). Several things can repeat or interrupt the work:

- the event is delivered more than once;
- several workers run;
- a worker crashes while a provider call is in flight;
- a provider answers late, partially or not at all.

Every repetition and interruption must end in at most one delivery per request, and a state that can be verified. Inventory and multi-source routing are Phase 10, so attempts run against one configured provider for now.

## Decision

1. **The job is a pointer; PostgreSQL is the state.**
   - `FULFILLMENT_REQUESTED` is routed to the `fulfillment.requested` job on a new `fulfillment` queue (job id = event id).
   - The processor checks the job against the committed outbox row, then runs `FulfillmentEngine` for that order.
   - Each run reloads the order, its fulfillment order and its latest attempt, and takes one step decided by the order status:
     - `QUEUED`/`RETRYING`: claim, then execute;
     - `PROCESSING`: verify a live attempt left by a crash, otherwise execute;
     - `FULFILLMENT_PENDING`: verify;
     - any other status: not eligible, and the job is acknowledged.
   - The amount comes from the order items, and the recipient from the order. The event payload is never trusted for either.
2. **One workflow per order: a lease in PostgreSQL.**
   - `fulfillment_orders.lease_token` and `lease_expires_at` (90 s) are taken with a conditional update.
   - A run that finds the lease held stops (`BUSY`) and runs again after the backoff.
   - Every write of a run is conditional on still holding the lease, and the final write releases it in the same transaction.
   - A crashed run's lease expires; the next run sees an `EXECUTING` attempt and verifies it.
   - No Redis or in-memory locks.
3. **One step, one transaction.** The attempt status, delivered amounts, every order transition (through the single orders transition writer), order history, attempt history, outbox events and the lease release commit together. If anything conflicts or fails, nothing is written. The attempt stays `EXECUTING`, and the next run verifies it instead of trusting a half-applied success.
4. **Attempt before call.** The attempt row is committed as `EXECUTING` before `fulfill` is called. If a crash happens after that, the result is unknown, so the next run verifies; it never sends again.
5. **Client reference per request, not per try.**
   - The reference is deterministic: `FULFILLMENT-<order id>-<n>`.
   - Every retry of a request the provider did not deliver reuses it with the same amount. This covers `RETRYABLE_FAILURE` and verification `NOT_FOUND`.
   - A new `n` is used only for a different request: the remainder after a partial delivery, or a manual retry after a final failure.
   - This amends ADR-005 §2 ("one per attempt").
   - Schema:
     - `client_reference` is text and no longer unique per row.
     - `UNIQUE(client_reference) WHERE status IN (SUCCEEDED, PARTIAL)`: at most one delivery is counted per reference.
     - `UNIQUE(fulfillment_order_id) WHERE status IN (PENDING, EXECUTING, VERIFYING, UNKNOWN)`: at most one live attempt per order.
6. **Verify before retry.**
   - `PENDING` and `UNKNOWN` (including `SUCCEEDED_BUT_TIMED_OUT`, a thrown adapter call, or an impossible delivered amount) move the order to `FULFILLMENT_PENDING`. The next runs only call `verify`.
   - Verification results:
     - `SUCCEEDED` / `PARTIAL`: settle the delivery.
     - `PENDING` / `UNAVAILABLE`: keep waiting.
     - `NOT_FOUND`: the only answer that allows sending the same request again.
     - `FAILED`: final for that request.
7. **Retries use the existing policy.** The job's retry policy (5 s, 15 s, 30 s, 60 s, 5 min; 5 runs, ARCHITECTURE.md §6.6) is the fulfillment retry and verification schedule. A run that is not finished throws `FulfillmentContinuesError`, and BullMQ runs it again after the backoff. The bound is enforced from both sides:
   - automatic retries counted in PostgreSQL (transitions to `RETRYING`) against the policy's maximum;
   - the job's final run, which may never leave a retry or verification waiting.

   When retries run out: `FAILED_PERMANENTLY` with `stopReason = RETRY_EXHAUSTED`, keeping the last provider error. When the outcome is still unknown on the final run: `RECONCILIATION_REQUIRED`.
8. **Outcome mapping** (all through the order state machine):
   - success: `PROCESSING → FULFILLMENT_PENDING → FULFILLED`;
   - partial: `→ PARTIALLY_FULFILLED → RETRYING`, remainder only;
   - retryable: `→ FAILED → RETRYING`;
   - permanent or invalid recipient: `→ FAILED → FAILED_PERMANENTLY`;
   - provider or recipient check unavailable, or insufficient balance: retryable, never a permanent failure on the first answer.

   Outbox events: `FULFILLMENT_STARTED`, `_PENDING`, `_PARTIAL`, `_FAILED`, `_RETRYING`, `_PERMANENTLY_FAILED`, `_COMPLETED` and `_RECONCILIATION_REQUIRED`. They are written in the transaction and not routed until their consumers exist.
9. **Provider selection behind a token.** `FULFILLMENT_PROVIDER_SELECTOR` returned the single configured provider code; with none or several it refused rather than guess. Superseded in Phase 10 by `FulfillmentAllocationService` (ADR-007): routing and reservation choose the source, `fulfillment_attempts.allocation_id` is filled, and the engine's workflow is unchanged.
10. **Routing only with a provider.** `FULFILLMENT_REQUESTED` is routed only when `FULFILLMENT_PROVIDER` is not `none`.
    - With `none` (production until an authorized provider exists), `QUEUED` orders wait with their request unpublished. They are delivered as a backlog once a provider is configured.
    - Compose sets `mock` for the development worker and `none` for the production worker. The Phase 8 production gate still refuses `mock`.

## Consequences

- Duplicate events, duplicate workers and crashes cannot cause a second delivery for a request.
  - The lease prevents concurrent execution.
  - The live-attempt index prevents two in-flight requests.
  - Verification decides every unknown outcome.
  - The stable reference lets an idempotent provider absorb a resend after `NOT_FOUND`.
- An order whose job is lost (Redis data loss), or whose last run found the lease busy, stays in `RETRYING`/`PROCESSING`/`FULFILLMENT_PENDING` with no job. The stuck-order sweep (ARCHITECTURE.md §6.7, reconciliation phase) re-emits it. Until then an operator re-publishes the event.
- Pending deliveries are verified for about 7 minutes (the retry schedule), then go to reconciliation. Providers with longer settlement need a dedicated verify job (`verify_deadline_at` exists for that).
- The mock's ledger is per process (ADR-005). A restarted development worker forgets simulated deliveries, so verification may report `NOT_FOUND` and resend. This affects development only. Its provider references carry a per-process prefix so they stay unique, as `UNIQUE(provider, external_reference)` requires.
- Retries are counted over the order's whole history. A future manual retry (`FAILED_PERMANENTLY → RETRYING`, admin phase) must decide how it resets that budget.
