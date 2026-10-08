-- Phase 12: add encrypted, item-level Telegram account inventory on the Phase 10 source and
-- allocation ledger. Existing sources, orders, and product prices are left unchanged.

CREATE TYPE "digital_inventory_item_status" AS ENUM (
  'AVAILABLE', 'RESERVED', 'SOLD', 'DELIVERED', 'BLOCKED'
);

ALTER TYPE "audit_action" ADD VALUE 'INVENTORY_ITEM_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'INVENTORY_ITEM_RESERVED';
ALTER TYPE "audit_action" ADD VALUE 'INVENTORY_ITEM_RELEASED';
ALTER TYPE "audit_action" ADD VALUE 'INVENTORY_ITEM_BLOCKED';
ALTER TYPE "audit_action" ADD VALUE 'INVENTORY_ITEM_SOLD';
ALTER TYPE "audit_action" ADD VALUE 'INVENTORY_ITEM_DELIVERED';

ALTER TABLE "products" ADD CONSTRAINT "products_id_product_line_key" UNIQUE ("id", "product_line");
ALTER TABLE "fulfillment_sources" ADD CONSTRAINT "fulfillment_sources_id_product_line_key" UNIQUE ("id", "product_line");

CREATE TABLE "digital_inventory_items" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "product_line" "product_line" NOT NULL DEFAULT 'TELEGRAM_ACCOUNT',
  "status" "digital_inventory_item_status" NOT NULL DEFAULT 'AVAILABLE',
  "encrypted_payload" BYTEA NOT NULL,
  "key_version" INTEGER NOT NULL,
  "allocation_id" UUID,
  "order_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "reserved_at" TIMESTAMPTZ(3),
  "sold_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "digital_inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "digital_inventory_items_line_check" CHECK ("product_line" = 'TELEGRAM_ACCOUNT'),
  CONSTRAINT "digital_inventory_items_ciphertext_check" CHECK (octet_length("encrypted_payload") >= 29),
  CONSTRAINT "digital_inventory_items_state_check" CHECK (
    ("status" IN ('AVAILABLE', 'BLOCKED') AND "allocation_id" IS NULL AND "order_id" IS NULL
      AND "reserved_at" IS NULL AND "sold_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'RESERVED' AND "allocation_id" IS NOT NULL AND "order_id" IS NOT NULL
      AND "reserved_at" IS NOT NULL AND "sold_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'SOLD' AND "allocation_id" IS NOT NULL AND "order_id" IS NOT NULL
      AND "reserved_at" IS NOT NULL AND "sold_at" IS NOT NULL AND "delivered_at" IS NULL)
    OR ("status" = 'DELIVERED' AND "allocation_id" IS NOT NULL AND "order_id" IS NOT NULL
      AND "reserved_at" IS NOT NULL AND "sold_at" IS NOT NULL AND "delivered_at" IS NOT NULL)
  ),
  CONSTRAINT "digital_inventory_items_product_id_product_line_fkey"
    FOREIGN KEY ("product_id", "product_line") REFERENCES "products"("id", "product_line") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_inventory_items_source_id_product_line_fkey"
    FOREIGN KEY ("source_id", "product_line") REFERENCES "fulfillment_sources"("id", "product_line") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_inventory_items_allocation_id_fkey"
    FOREIGN KEY ("allocation_id") REFERENCES "fulfillment_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_inventory_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "digital_inventory_items_product_id_status_created_at_idx"
  ON "digital_inventory_items"("product_id", "status", "created_at");
CREATE INDEX "digital_inventory_items_source_id_status_created_at_idx"
  ON "digital_inventory_items"("source_id", "status", "created_at");
CREATE INDEX "digital_inventory_items_allocation_id_status_idx"
  ON "digital_inventory_items"("allocation_id", "status");
CREATE INDEX "digital_inventory_items_order_id_status_idx"
  ON "digital_inventory_items"("order_id", "status");
