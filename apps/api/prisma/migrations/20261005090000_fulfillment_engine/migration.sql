-- Phase 9 fulfillment engine (ARCHITECTURE.md §6.4):
--  1. A lease on fulfillment_orders: exactly one worker runs an order's workflow at a time, and a
--     crashed worker's order becomes claimable again once the lease expires.
--  2. Attempts run against one provider until inventory allocation exists (Phase 10), so
--     allocation_id becomes optional.
--  3. The client reference is deterministic (FULFILLMENT-<order id>-<n>) and shared by every retry
--     of a request the provider did not deliver, so it is text and no longer unique per row.
--     Instead: at most one live attempt per fulfillment order, and at most one delivered
--     (SUCCEEDED/PARTIAL) attempt per reference.
-- Additive for data: fulfillment tables have no rows before Phase 9.
-- Down: DROP INDEX "fulfillment_attempts_one_live_per_order", "fulfillment_attempts_one_delivery_per_reference",
--       "fulfillment_attempts_client_reference_idx";
--       ALTER TABLE "fulfillment_attempts" ALTER COLUMN "client_reference" TYPE uuid USING "client_reference"::uuid,
--         ALTER COLUMN "client_reference" SET DEFAULT gen_random_uuid(), ALTER COLUMN "allocation_id" SET NOT NULL;
--       CREATE UNIQUE INDEX "fulfillment_attempts_client_reference_key" ON "fulfillment_attempts"("client_reference");
--       ALTER TABLE "fulfillment_orders" DROP CONSTRAINT "fulfillment_orders_lease_complete",
--         DROP COLUMN "lease_token", DROP COLUMN "lease_expires_at";

ALTER TABLE "fulfillment_orders"
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "fulfillment_orders_lease_complete" CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL));

ALTER TABLE "fulfillment_attempts" ALTER COLUMN "allocation_id" DROP NOT NULL;

DROP INDEX "fulfillment_attempts_client_reference_key";
ALTER TABLE "fulfillment_attempts"
  ALTER COLUMN "client_reference" DROP DEFAULT,
  ALTER COLUMN "client_reference" SET DATA TYPE TEXT USING "client_reference"::text;

CREATE INDEX "fulfillment_attempts_client_reference_idx" ON "fulfillment_attempts"("client_reference");

CREATE UNIQUE INDEX "fulfillment_attempts_one_live_per_order" ON "fulfillment_attempts"("fulfillment_order_id")
  WHERE (status IN ('PENDING', 'EXECUTING', 'VERIFYING', 'UNKNOWN'));

CREATE UNIQUE INDEX "fulfillment_attempts_one_delivery_per_reference" ON "fulfillment_attempts"("client_reference")
  WHERE (status IN ('SUCCEEDED', 'PARTIAL'));
