-- Phase 10 inventory and smart routing (ARCHITECTURE.md §6.5, ADR-007):
--  1. Sources: edge-triggered low-balance state (one alert per crossing) and a consecutive provider
--     failure counter behind the health state.
--  2. Allocations: an allocation stays RESERVED while part of it is consumed (a partial delivery
--     whose remainder is still expected from the same source); it never holds more than its amount.
--     Routing strategy and decision are recorded for operators. The cost snapshot is NULL when the
--     source has no cost configured (no invented zero cost).
--  3. Attempts: several attempts may execute one allocation (retries, the remainder after a partial
--     delivery), so allocation_id is indexed instead of unique. One live attempt per fulfillment
--     order (Phase 9) still prevents two requests in flight.
-- Down: DROP INDEX "fulfillment_attempts_allocation_id_idx";
--       CREATE UNIQUE INDEX "fulfillment_attempts_allocation_id_key" ON "fulfillment_attempts"("allocation_id");
--       ALTER TABLE "fulfillment_allocations" DROP CONSTRAINT "fulfillment_allocations_reserved_unsettled",
--         DROP CONSTRAINT "fulfillment_allocations_settled_within_amount", DROP COLUMN "routing_strategy",
--         DROP COLUMN "routing_decision", ALTER COLUMN "unit_cost_snapshot" SET NOT NULL,
--         ADD CONSTRAINT "fulfillment_allocations_reserved_unsettled"
--           CHECK (status <> 'RESERVED' OR (consumed_amount = 0 AND released_amount = 0 AND settled_at IS NULL));
--       ALTER TABLE "fulfillment_sources" DROP CONSTRAINT "fulfillment_sources_failures_non_negative",
--         DROP COLUMN "low_balance_since", DROP COLUMN "consecutive_failures";

ALTER TABLE "fulfillment_sources"
  ADD COLUMN "low_balance_since" TIMESTAMPTZ(3),
  ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "fulfillment_sources_failures_non_negative" CHECK (consecutive_failures >= 0);

ALTER TABLE "fulfillment_allocations"
  ADD COLUMN "routing_strategy" TEXT,
  ADD COLUMN "routing_decision" JSONB,
  ALTER COLUMN "unit_cost_snapshot" DROP NOT NULL,
  DROP CONSTRAINT "fulfillment_allocations_reserved_unsettled",
  ADD CONSTRAINT "fulfillment_allocations_reserved_unsettled"
    CHECK (status <> 'RESERVED' OR (released_amount = 0 AND consumed_amount < amount AND settled_at IS NULL)),
  ADD CONSTRAINT "fulfillment_allocations_settled_within_amount"
    CHECK (consumed_amount + released_amount <= amount);

DROP INDEX "fulfillment_attempts_allocation_id_key";
CREATE INDEX "fulfillment_attempts_allocation_id_idx" ON "fulfillment_attempts"("allocation_id");
