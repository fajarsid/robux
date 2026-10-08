-- Integrity rules Prisma cannot express: CHECK constraints and append-only triggers.
-- Rationale: docs/DATABASE.md §3 (money), §5 (identifiers), §8 (inventory), §9 (append-only).
-- Down: drop the triggers, the function forbid_row_mutation() and each constraint named below.

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalised" CHECK (email = lower(email) AND position('@' in email) > 1);

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_token_hash_hex" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "user_sessions_idle_within_absolute" CHECK (idle_expires_at <= expires_at);

ALTER TABLE "login_attempts"
  ADD CONSTRAINT "login_attempts_email_hash_hex" CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "login_attempts_reason_matches_outcome"
    CHECK ((succeeded AND failure_reason IS NULL) OR (NOT succeeded AND failure_reason IS NOT NULL));

-- ---------------------------------------------------------------------------------------------
-- Catalog and pricing
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "products"
  ADD CONSTRAINT "products_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "products_robux_amount_positive" CHECK (robux_amount > 0),
  ADD CONSTRAINT "products_quantity_limits" CHECK (min_quantity >= 1 AND max_quantity >= min_quantity);

ALTER TABLE "product_prices"
  ADD CONSTRAINT "product_prices_version_positive" CHECK (version >= 1),
  ADD CONSTRAINT "product_prices_selling_positive" CHECK (selling_price > 0),
  ADD CONSTRAINT "product_prices_cost_non_negative" CHECK (cost_price >= 0),
  ADD CONSTRAINT "product_prices_idr_whole"
    CHECK (currency <> 'IDR' OR (selling_price = trunc(selling_price) AND cost_price = trunc(cost_price)));

-- ---------------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_order_number_format" CHECK (order_number ~ '^RBX-[0-9]{8}-[0-9]{5,}$'),
  ADD CONSTRAINT "orders_tracking_token_hash_hex" CHECK (tracking_token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "orders_idempotency_key_length" CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  ADD CONSTRAINT "orders_contact_email_normalised" CHECK (contact_email = lower(contact_email) AND position('@' in contact_email) > 1),
  ADD CONSTRAINT "orders_amounts_non_negative" CHECK (subtotal >= 0 AND discount >= 0 AND fee >= 0 AND total >= 0),
  ADD CONSTRAINT "orders_total_arithmetic" CHECK (total = subtotal - discount + fee),
  ADD CONSTRAINT "orders_idr_whole"
    CHECK (currency <> 'IDR' OR (subtotal = trunc(subtotal) AND discount = trunc(discount) AND fee = trunc(fee) AND total = trunc(total))),
  ADD CONSTRAINT "orders_recipient_user_id_positive" CHECK (recipient_roblox_user_id > 0),
  ADD CONSTRAINT "orders_cancel_reason_matches_status"
    CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL));

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK (quantity > 0),
  ADD CONSTRAINT "order_items_robux_amount_positive" CHECK (robux_amount > 0),
  ADD CONSTRAINT "order_items_prices_non_negative" CHECK (unit_price_snapshot >= 0 AND unit_cost_snapshot >= 0),
  ADD CONSTRAINT "order_items_line_arithmetic" CHECK (line_subtotal = unit_price_snapshot * quantity),
  ADD CONSTRAINT "order_items_idr_whole"
    CHECK (currency <> 'IDR' OR (unit_price_snapshot = trunc(unit_price_snapshot) AND unit_cost_snapshot = trunc(unit_cost_snapshot)));

ALTER TABLE "order_number_counters"
  ADD CONSTRAINT "order_number_counters_positive" CHECK (last_value > 0);

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_request_hash_hex" CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_keys_completed_has_response"
    CHECK (status <> 'COMPLETED' OR response_status IS NOT NULL);

-- ---------------------------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK (amount > 0),
  ADD CONSTRAINT "payments_idr_whole" CHECK (currency <> 'IDR' OR amount = trunc(amount)),
  ADD CONSTRAINT "payments_fee_non_negative" CHECK (gateway_fee IS NULL OR gateway_fee >= 0),
  ADD CONSTRAINT "payments_callback_count_non_negative" CHECK (callback_count >= 0),
  ADD CONSTRAINT "payments_paid_has_timestamp" CHECK (status <> 'PAID' OR paid_at IS NOT NULL);

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_payload_hash_hex" CHECK (payload_hash ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------------------------
-- Fulfillment and inventory
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "fulfillment_orders"
  ADD CONSTRAINT "fulfillment_orders_requested_positive" CHECK (requested_amount > 0),
  ADD CONSTRAINT "fulfillment_orders_fulfilled_bounds" CHECK (fulfilled_amount >= 0 AND fulfilled_amount <= requested_amount),
  ADD CONSTRAINT "fulfillment_orders_remaining_arithmetic" CHECK (remaining_amount = requested_amount - fulfilled_amount);

ALTER TABLE "fulfillment_attempts"
  ADD CONSTRAINT "fulfillment_attempts_number_positive" CHECK (attempt_number >= 1),
  ADD CONSTRAINT "fulfillment_attempts_requested_positive" CHECK (requested_amount > 0),
  ADD CONSTRAINT "fulfillment_attempts_fulfilled_bounds" CHECK (fulfilled_amount >= 0 AND fulfilled_amount <= requested_amount);

ALTER TABLE "fulfillment_allocations"
  ADD CONSTRAINT "fulfillment_allocations_amount_positive" CHECK (amount > 0),
  ADD CONSTRAINT "fulfillment_allocations_settled_non_negative" CHECK (consumed_amount >= 0 AND released_amount >= 0),
  ADD CONSTRAINT "fulfillment_allocations_reserved_unsettled"
    CHECK (status <> 'RESERVED' OR (consumed_amount = 0 AND released_amount = 0 AND settled_at IS NULL)),
  ADD CONSTRAINT "fulfillment_allocations_terminal_fully_settled"
    CHECK (status = 'RESERVED' OR (consumed_amount + released_amount = amount AND settled_at IS NOT NULL)),
  ADD CONSTRAINT "fulfillment_allocations_released_has_no_consumption"
    CHECK (status <> 'RELEASED' OR consumed_amount = 0),
  ADD CONSTRAINT "fulfillment_allocations_unit_cost_non_negative" CHECK (unit_cost_snapshot >= 0);

ALTER TABLE "fulfillment_sources"
  ADD CONSTRAINT "fulfillment_sources_available_non_negative" CHECK (available_balance >= 0),
  ADD CONSTRAINT "fulfillment_sources_reserved_non_negative" CHECK (reserved_balance >= 0),
  ADD CONSTRAINT "fulfillment_sources_threshold_non_negative" CHECK (low_balance_threshold >= 0),
  ADD CONSTRAINT "fulfillment_sources_cost_non_negative" CHECK (cost_per_unit IS NULL OR cost_per_unit >= 0);

ALTER TABLE "source_balance_logs"
  ADD CONSTRAINT "source_balance_logs_results_non_negative" CHECK (available_after >= 0 AND reserved_after >= 0);

-- ---------------------------------------------------------------------------------------------
-- Gamepass and messaging
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "gamepass_orders"
  ADD CONSTRAINT "gamepass_orders_target_positive" CHECK (target_net_amount > 0),
  ADD CONSTRAINT "gamepass_orders_gross_covers_net" CHECK (gross_price >= target_net_amount),
  ADD CONSTRAINT "gamepass_orders_fee_rate_bounds" CHECK (fee_rate >= 0 AND fee_rate < 1);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_non_negative" CHECK (attempts >= 0);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts_non_negative" CHECK (attempts >= 0);

-- ---------------------------------------------------------------------------------------------
-- Append-only tables: history, ledger, prices and audit must never be rewritten.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION forbid_row_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "product_prices_append_only" BEFORE UPDATE OR DELETE ON "product_prices"
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
CREATE TRIGGER "product_prices_no_truncate" BEFORE TRUNCATE ON "product_prices"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_row_mutation();

CREATE TRIGGER "order_status_history_append_only" BEFORE UPDATE OR DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
CREATE TRIGGER "order_status_history_no_truncate" BEFORE TRUNCATE ON "order_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_row_mutation();

CREATE TRIGGER "fulfillment_attempt_status_history_append_only" BEFORE UPDATE OR DELETE ON "fulfillment_attempt_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
CREATE TRIGGER "fulfillment_attempt_status_history_no_truncate" BEFORE TRUNCATE ON "fulfillment_attempt_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_row_mutation();

CREATE TRIGGER "source_balance_logs_append_only" BEFORE UPDATE OR DELETE ON "source_balance_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
CREATE TRIGGER "source_balance_logs_no_truncate" BEFORE TRUNCATE ON "source_balance_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_row_mutation();

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_row_mutation();
