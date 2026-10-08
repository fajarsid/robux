-- Phase 5 order engine (docs/DATABASE.md, IMPLEMENTATION_PLAN.md §15):
--  1. orders.tax: the snapshot keeps every step of subtotal - discount + fee + tax = total (D-06).
--  2. orders.recipient_roblox_user_id becomes nullable: the Roblox id is resolved in Phase 11; until
--     then the order keeps the username the customer entered.
--  3. orders.payment_expires_at: the payment deadline fixed at creation, swept by the worker.
-- Down: drop the index and the two columns, restore NOT NULL (after backfilling ids) and the
-- previous CHECK definitions from 20261005010100_integrity_constraints.

ALTER TABLE "orders"
  ADD COLUMN "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "payment_expires_at" TIMESTAMPTZ(3),
  ALTER COLUMN "recipient_roblox_user_id" DROP NOT NULL;

CREATE INDEX "orders_status_payment_expires_at_idx" ON "orders"("status", "payment_expires_at");

ALTER TABLE "orders"
  DROP CONSTRAINT "orders_amounts_non_negative",
  DROP CONSTRAINT "orders_total_arithmetic",
  DROP CONSTRAINT "orders_idr_whole";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative"
    CHECK (subtotal >= 0 AND discount >= 0 AND fee >= 0 AND tax >= 0 AND total >= 0 AND discount <= subtotal),
  ADD CONSTRAINT "orders_total_arithmetic" CHECK (total = subtotal - discount + fee + tax),
  ADD CONSTRAINT "orders_idr_whole"
    CHECK (currency <> 'IDR' OR (subtotal = trunc(subtotal) AND discount = trunc(discount) AND fee = trunc(fee) AND tax = trunc(tax) AND total = trunc(total))),
  ADD CONSTRAINT "orders_payment_deadline_after_creation"
    CHECK (payment_expires_at IS NULL OR payment_expires_at > created_at);
