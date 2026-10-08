-- Preserve existing IDR payment records while allowing Stars settlement attempts to be stored in XTR.
ALTER TYPE payment_gateway_code ADD VALUE IF NOT EXISTS 'TELEGRAM_STARS';
ALTER TYPE webhook_source ADD VALUE IF NOT EXISTS 'TELEGRAM_STARS';

CREATE TYPE payment_currency AS ENUM ('IDR', 'XTR');
-- Drop before changing the enum type because PostgreSQL cannot re-parse the old CHECK against it.
ALTER TABLE payments DROP CONSTRAINT payments_idr_whole;
ALTER TABLE payments
  ALTER COLUMN currency TYPE payment_currency
  USING currency::text::payment_currency;
-- The legacy whole-IDR CHECK was bound to the old `currency` enum type; recreate it against
-- payment_currency while retaining the same IDR invariant and allowing integer XTR amounts.
ALTER TABLE payments ADD CONSTRAINT payments_idr_whole
  CHECK (currency <> 'IDR' OR amount = trunc(amount));
ALTER TABLE payments ADD CONSTRAINT payments_xtr_whole
  CHECK (currency <> 'XTR' OR amount = trunc(amount));
ALTER TABLE payments ADD COLUMN qr_payload text
  CHECK (qr_payload IS NULL OR length(qr_payload) BETWEEN 1 AND 4096);

-- A product price may have an independently versioned Telegram Stars quote.
ALTER TABLE product_prices ADD COLUMN stars_amount integer;
ALTER TABLE product_prices ADD CONSTRAINT product_prices_stars_amount_positive
  CHECK (stars_amount IS NULL OR stars_amount > 0);

-- Snapshot the Stars quote used at checkout; later product/quote changes cannot alter an open order.
ALTER TABLE order_items ADD COLUMN stars_amount_snapshot integer;
ALTER TABLE order_items ADD CONSTRAINT order_items_stars_amount_snapshot_positive
  CHECK (stars_amount_snapshot IS NULL OR stars_amount_snapshot > 0);

-- Treasury records contain amounts and public transaction references only; never wallet keys.
CREATE TYPE treasury_asset AS ENUM ('TON', 'USDT');
CREATE TYPE treasury_direction AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE treasury_transaction_type AS ENUM ('BINANCE_REFILL', 'TON_SUPPLIER_PAYMENT', 'TON_GAS', 'TON_SWAP', 'MANUAL_ADJUSTMENT');
CREATE TYPE treasury_transaction_status AS ENUM ('REQUESTED', 'PROCESSING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'RECONCILIATION_REQUIRED');

CREATE TABLE treasury_transactions (
  id uuid PRIMARY KEY,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  transaction_type treasury_transaction_type NOT NULL,
  asset treasury_asset NOT NULL,
  amount_nano bigint NOT NULL CHECK (amount_nano > 0),
  direction treasury_direction NOT NULL,
  provider varchar(40) NOT NULL,
  external_reference varchar(255),
  destination_address varchar(128),
  status treasury_transaction_status NOT NULL DEFAULT 'REQUESTED',
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  confirmed_at timestamptz(3),
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT treasury_transactions_confirmed_at_check
    CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

CREATE UNIQUE INDEX treasury_transactions_provider_reference_key
  ON treasury_transactions(provider, external_reference);
CREATE INDEX treasury_transactions_status_created_at_idx
  ON treasury_transactions(status, created_at);

-- Ledger records are append-only; status transitions are maintained separately by a later workflow.
