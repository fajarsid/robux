-- Phase 11 Digital Fulfillment Core (ADR-009): products, sources and orders are classified by a
-- product line, from which platform, fulfillment type and recipient kind follow.
--  1. Every existing product, source and order is Robux: the new columns default to ROBLOX_ROBUX /
--     ROBLOX / BALANCE_PURCHASE / ROBLOX_USER (filled into existing rows by the defaults), so no row
--     changes meaning. The defaults stay so existing writers keep working.
--  2. orders.recipient_username becomes nullable: digital delivery (an account from inventory) has
--     no recipient. CHECKs keep line, platform, type and recipient consistent, so a snapshot can
--     never describe an impossible order.
--  3. Gamepass delivery stays a Robux-only method.
-- Non-destructive: only additions, a relaxed NOT NULL and CHECKs that every existing row satisfies.
-- Down: DROP the CHECKs and index below; ALTER TABLE "orders" ALTER COLUMN "recipient_username" SET NOT NULL
--       (only while no digital-delivery order exists); DROP COLUMN "product_line", "platform",
--       "fulfillment_type", "recipient_type" (orders), "product_line" (products, fulfillment_sources);
--       DROP TYPE "recipient_type", "fulfillment_type", "platform", "product_line".

CREATE TYPE "product_line" AS ENUM ('ROBLOX_ROBUX', 'TELEGRAM_PREMIUM', 'TELEGRAM_STARS', 'TELEGRAM_ACCOUNT');
CREATE TYPE "platform" AS ENUM ('ROBLOX', 'TELEGRAM');
CREATE TYPE "fulfillment_type" AS ENUM ('DIGITAL_DELIVERY', 'RECIPIENT_FULFILLMENT', 'BALANCE_PURCHASE');
CREATE TYPE "recipient_type" AS ENUM ('ROBLOX_USER', 'TELEGRAM_USER');

ALTER TABLE "products"
  ADD COLUMN "product_line" "product_line" NOT NULL DEFAULT 'ROBLOX_ROBUX',
  ADD CONSTRAINT "products_gamepass_is_robux" CHECK (fulfillment_method = 'INSTANT' OR product_line = 'ROBLOX_ROBUX');

ALTER TABLE "fulfillment_sources"
  ADD COLUMN "product_line" "product_line" NOT NULL DEFAULT 'ROBLOX_ROBUX';
CREATE INDEX "fulfillment_sources_product_line_status_health_idx" ON "fulfillment_sources"("product_line", "status", "health");

ALTER TABLE "orders"
  ADD COLUMN "product_line" "product_line" NOT NULL DEFAULT 'ROBLOX_ROBUX',
  ADD COLUMN "platform" "platform" NOT NULL DEFAULT 'ROBLOX',
  ADD COLUMN "fulfillment_type" "fulfillment_type" NOT NULL DEFAULT 'BALANCE_PURCHASE',
  ADD COLUMN "recipient_type" "recipient_type" DEFAULT 'ROBLOX_USER',
  ALTER COLUMN "recipient_username" DROP NOT NULL;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_product_line_consistent" CHECK (
    (product_line = 'ROBLOX_ROBUX' AND platform = 'ROBLOX' AND fulfillment_type = 'BALANCE_PURCHASE')
    OR (product_line IN ('TELEGRAM_PREMIUM', 'TELEGRAM_STARS') AND platform = 'TELEGRAM' AND fulfillment_type = 'RECIPIENT_FULFILLMENT')
    OR (product_line = 'TELEGRAM_ACCOUNT' AND platform = 'TELEGRAM' AND fulfillment_type = 'DIGITAL_DELIVERY')
  ),
  ADD CONSTRAINT "orders_recipient_matches_type" CHECK (
    (fulfillment_type = 'DIGITAL_DELIVERY' AND recipient_username IS NULL AND recipient_type IS NULL)
    OR (
      fulfillment_type <> 'DIGITAL_DELIVERY'
      AND recipient_username IS NOT NULL
      AND recipient_type = (CASE platform WHEN 'ROBLOX' THEN 'ROBLOX_USER' ELSE 'TELEGRAM_USER' END)::recipient_type
    )
  ),
  ADD CONSTRAINT "orders_roblox_user_id_only_for_roblox" CHECK (
    recipient_roblox_user_id IS NULL OR recipient_type = 'ROBLOX_USER'
  ),
  ADD CONSTRAINT "orders_gamepass_is_robux" CHECK (fulfillment_method = 'INSTANT' OR product_line = 'ROBLOX_ROBUX');
