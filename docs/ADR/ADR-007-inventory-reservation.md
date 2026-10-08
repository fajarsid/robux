# ADR-007: Inventory reservation and smart routing

**Status:** Accepted (Phase 10)
**Related:** ARCHITECTURE.md §5.4, §5.5, §6.4, §6.5; DATABASE.md §8; ADR-006 (fulfillment engine); IMPLEMENTATION_PLAN.md D-08

## Context

Phase 9 sent every request to the single configured provider. Robux are held on several fulfillment sources: each source has a provider, a balance, a priority, a cost and a health state. Phase 10 must decide which source(s) deliver an order, and how much each one delivers, without overselling. Several workers and several orders compete for the same balances.

The split of responsibilities stays strict:

- Phase 10 decides where and how much.
- Phase 9 decides how the workflow is executed (lease, attempts, verification, retries).
- The provider adapter (Phase 8) performs the operation.

## Decision

1. **PostgreSQL is the authority for local inventory.**
   - `fulfillment_sources.available_balance` and `reserved_balance` (`BIGINT`, CHECK ≥ 0).
   - Every movement writes a `source_balance_logs` row: `RESERVE` (available − n, reserved + n), `CONSUME` (reserved − n), `RELEASE` (reserved − n, available + n) and `ADJUSTMENT` (staff, available ± n).
   - The provider remains the authority on its real external balance. The executor still asks it before sending, and reconciling the two is a later phase. The health check uses the provider balance as a liveness probe only.
2. **Routing is a pure function (`inventory/domain/routing.ts`, strategy `SMART_V1`).** The same sources and amount always give the same plan.
   - Only sources that pass every check are eligible:
     - status `ACTIVE` (kill switch off);
     - health `HEALTHY` or `DEGRADED`;
     - a provider configured in this process;
     - a positive balance.
   - Plans are ranked, in this order:
     1. the plan covers the whole amount (no partial plans);
     2. fewest sources;
     3. least surplus (Σ chosen balances − amount, i.e. best fit);
     4. tie-breaks: the sorted priority list (lower number first), then cost (unconfigured last), then source id.
   - Above 5,000 combinations, a deterministic best-fit greedy plan is used, still with the minimal number of sources.
   - Inside a split plan, the smaller sources are drained and the largest supplies the rest.
   - The decision record (strategy, amount, candidates with exclusion reasons, source count, surplus, reason) is stored on each allocation.
3. **Reservation is atomic and validated by the write, not the read.**
   - The plan is computed from a snapshot.
   - One transaction then holds the order's lease (which locks the fulfillment order row) and requires that no allocation of the order is open.
   - For each planned source, in ascending id order, it runs `UPDATE … SET available − n, reserved + n WHERE status='ACTIVE' AND health IN (…) AND available ≥ n`, inserts the allocation (with cost snapshot and routing record) and its ledger row.
   - If any source fails the WHERE clause, the whole transaction rolls back (`ReservationConflictError`) and routing runs again on fresh balances, up to three rounds.
   - If no plan exists, the explicit outcome is `NO_ELIGIBLE_SOURCE`: a retryable step failure that never creates or invents inventory.
4. **Allocations follow the request.**
   - An open (`RESERVED`) allocation is always executed first, so a retry, a verification or a remainder never reserves twice.
   - An allocation may be partly consumed while still `RESERVED`: a partial delivery keeps the remainder reserved for the same source.
   - Attempts reference their allocation (`allocation_id`, no longer unique). A multi-source plan is executed allocation by allocation in the same run, while the run holds the lease. Each allocation gets its own client reference (ADR-006 rule: a different request means a different reference).
5. **Settlement happens in the engine's step transaction** (`settleInventory`):

   | Step outcome | Inventory effect |
   | --- | --- |
   | Delivered | consume that amount |
   | Not delivered, retryable | release this allocation; the remainder is routed again, possibly elsewhere |
   | Final outcome (fulfilled, permanently failed, retries exhausted) | release every open allocation |
   | Pending or unknown (including reconciliation) | keep the reservation |

   Release is idempotent, so a second release changes nothing. A consumed allocation is never released back.
6. **No reservation expiry by time.** Every open allocation belongs to a workflow that is continued by its job. A crashed run's lease expires, and the next run continues with the open allocation. Allocations of `RECONCILIATION_REQUIRED` orders stay reserved, because Robux may have left the source; a person decides. A timer that released them could make Robux available twice.
7. **Kill switch and health.**
   - `status=DISABLED` (staff, audited) removes a source from routing. Its existing allocations finish their lifecycle and releases still return to it.
   - Provider failures (`UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED`) increment `consecutive_failures`:
     - one failure makes the source `DEGRADED`, which is still routable;
     - three in a row make it `UNAVAILABLE` and write a `SOURCE_UNAVAILABLE` event once;
     - any success makes it `HEALTHY` again.
   - The scheduler's `inventory.source-health-check` job (queue `inventory-sync`, every minute) probes ACTIVE sources that are `UNAVAILABLE` or `UNKNOWN`, and restores them when their provider answers.
8. **Low balance is edge-triggered.**
   - `low_balance_since` is set by the update that takes `available_balance` below `low_balance_threshold`. Only that update writes `SOURCE_LOW_BALANCE`.
   - While the source stays low nothing more is written. Going back to or above the threshold clears the mark and re-arms the alert.
   - Events are not routed until the notification phase.
9. **Cost snapshot.** `unit_cost_snapshot` copies `cost_per_unit` at reservation. It is `NULL` when no cost is configured, rather than an invented zero. Later cost changes never touch existing allocations. Customer pricing is unaffected.
10. **Staff management.**
    - `GET/POST /admin/inventory/sources`, `PATCH /:id`, `POST /:id/activate|deactivate|adjustments`.
    - Reading needs `inventory.read` (OPERATOR+); the cost per unit is only shown with `inventory.manage`. Changes need `inventory.manage` (ADMIN+) and are audited.
    - New sources start `DISABLED` with health `UNKNOWN`.
    - The provider code is fixed after creation. Credentials are never set or returned here.

## Consequences

- Concurrent orders and workers cannot over-reserve: the conditional UPDATE and the CHECKs decide. This is tested with 2 and 10 concurrent orders on one source, two 1500 orders on two 1000 sources, and duplicate workers.
- A failing source loses its reservation at once and the order is routed again. Constant failure churns reservations, but nothing stays stuck.
- With one healthy source left, routing keeps choosing it. With none, orders wait (`NO_ELIGIBLE_SOURCE`) until stock or health returns, or the retry budget ends (`FAILED_PERMANENTLY`, inventory released).
- Product availability still uses the aggregate of eligible balances. A multi-source plan exists exactly when that total covers the amount, so the two agree, except that availability does not know which providers the worker has configured.
