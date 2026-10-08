-- Phase 6 payment core (docs/DATABASE.md §7, docs/integrations/duitku.md):
--  1. At most one PENDING payment attempt per order, so concurrent "pay" requests cannot open two
--     live gateway transactions for the same order (a customer could otherwise pay twice).
--  2. A PAID payment always carries the gateway reference it was verified against.
-- Additive: the payments table has no rows before Phase 6.
-- Down: DROP INDEX "payments_one_pending_per_order";
--       ALTER TABLE "payments" DROP CONSTRAINT "payments_paid_has_reference";

CREATE UNIQUE INDEX "payments_one_pending_per_order" ON "payments"("order_id") WHERE (status = 'PENDING');

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_paid_has_reference" CHECK (status <> 'PAID' OR gateway_reference IS NOT NULL);
