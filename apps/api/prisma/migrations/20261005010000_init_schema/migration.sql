-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_FAILURE', 'RECOVERY_CODE_USED', 'PRODUCT_CREATED', 'PRODUCT_CHANGED', 'PRODUCT_ACTIVATED', 'PRODUCT_DEACTIVATED', 'PRICE_CHANGED', 'ORDER_RETRY', 'ORDER_CANCEL', 'ORDER_REFUND', 'MANUAL_FULFILLMENT', 'SOURCE_CREATED', 'SOURCE_CHANGED', 'SOURCE_ENABLED', 'SOURCE_DISABLED', 'SETTING_CHANGED', 'RECONCILIATION_RESOLVED', 'STAFF_ACCOUNT_CHANGED');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "reconciliation_kind" AS ENUM ('PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_STATUS_MISMATCH', 'FULFILLMENT_OUTCOME_UNKNOWN', 'PROVIDER_LEDGER_MISMATCH');

-- CreateEnum
CREATE TYPE "reconciliation_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('IDR');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('SYSTEM', 'CUSTOMER', 'STAFF', 'PAYMENT_GATEWAY', 'FULFILLMENT_PROVIDER', 'SCHEDULER');

-- CreateEnum
CREATE TYPE "fulfillment_method" AS ENUM ('INSTANT', 'GAMEPASS');

-- CreateEnum
CREATE TYPE "fulfillment_order_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'PARTIALLY_FULFILLED', 'FULFILLED', 'FAILED', 'RECONCILIATION_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fulfillment_attempt_status" AS ENUM ('PENDING', 'EXECUTING', 'VERIFYING', 'SUCCEEDED', 'PARTIAL', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "allocation_status" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "gamepass_order_status" AS ENUM ('AWAITING_GAMEPASS', 'GAMEPASS_DETECTED', 'VALIDATING', 'FULFILLMENT_PENDING', 'FULFILLED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'OPERATOR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "login_failure_reason" AS ENUM ('INVALID_CREDENTIALS', 'ACCOUNT_SUSPENDED', 'ACCOUNT_LOCKED', 'INVALID_TWO_FACTOR', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "source_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "source_health" AS ENUM ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "balance_change_reason" AS ENUM ('RESERVE', 'CONSUME', 'RELEASE', 'SYNC', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('TELEGRAM', 'DISCORD', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAID', 'QUEUED', 'PROCESSING', 'FULFILLMENT_PENDING', 'FULFILLED', 'FAILED', 'RETRYING', 'FAILED_PERMANENTLY', 'PARTIALLY_FULFILLED', 'RECONCILIATION_REQUIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "order_cancel_reason" AS ENUM ('CUSTOMER_REQUEST', 'PAYMENT_EXPIRED', 'STAFF_ACTION');

-- CreateEnum
CREATE TYPE "idempotency_key_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "payment_gateway_code" AS ENUM ('MOCK', 'DUITKU');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "webhook_source" AS ENUM ('MOCK_GATEWAY', 'DUITKU', 'FULFILLMENT_PROVIDER');

-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_role" TEXT,
    "action" "audit_action" NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "result" "audit_result" NOT NULL,
    "reason" TEXT,
    "ip_masked" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_cases" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "payment_id" UUID,
    "attempt_id" UUID,
    "kind" "reconciliation_kind" NOT NULL,
    "status" "reconciliation_status" NOT NULL DEFAULT 'OPEN',
    "evidence" JSONB NOT NULL,
    "resolution" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reconciliation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "robux_amount" INTEGER NOT NULL,
    "fulfillment_method" "fulfillment_method" NOT NULL,
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "max_quantity" INTEGER NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "selling_price" DECIMAL(18,2) NOT NULL,
    "cost_price" DECIMAL(18,2) NOT NULL,
    "currency" "currency" NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_orders" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "fulfillment_method" NOT NULL,
    "requested_amount" INTEGER NOT NULL,
    "fulfilled_amount" INTEGER NOT NULL DEFAULT 0,
    "remaining_amount" INTEGER NOT NULL,
    "status" "fulfillment_order_status" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fulfillment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_attempts" (
    "id" UUID NOT NULL,
    "fulfillment_order_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "requested_amount" INTEGER NOT NULL,
    "fulfilled_amount" INTEGER NOT NULL DEFAULT 0,
    "client_reference" UUID NOT NULL,
    "external_reference" TEXT,
    "status" "fulfillment_attempt_status" NOT NULL DEFAULT 'PENDING',
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "verify_deadline_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fulfillment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_attempt_status_history" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "from_status" "fulfillment_attempt_status",
    "to_status" "fulfillment_attempt_status" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_attempt_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_allocations" (
    "id" UUID NOT NULL,
    "fulfillment_order_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "consumed_amount" INTEGER NOT NULL DEFAULT 0,
    "released_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "allocation_status" NOT NULL DEFAULT 'RESERVED',
    "currency" "currency" NOT NULL,
    "unit_cost_snapshot" DECIMAL(18,4) NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fulfillment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gamepass_orders" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "target_net_amount" INTEGER NOT NULL,
    "gross_price" INTEGER NOT NULL,
    "fee_rate" DECIMAL(5,4) NOT NULL,
    "gamepass_id" BIGINT,
    "status" "gamepass_order_status" NOT NULL DEFAULT 'AWAITING_GAMEPASS',
    "detected_at" TIMESTAMPTZ(3),
    "sla_due_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gamepass_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'CUSTOMER',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "two_factor_verified" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_2fa" (
    "user_id" UUID NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "enabled_at" TIMESTAMPTZ(3),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_2fa_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "admin_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "email_hash" CHAR(64) NOT NULL,
    "user_id" UUID,
    "ip_address" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "failure_reason" "login_failure_reason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_sources" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_reference" TEXT,
    "credential_ref" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "source_status" NOT NULL DEFAULT 'DISABLED',
    "health" "source_health" NOT NULL DEFAULT 'UNKNOWN',
    "available_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "low_balance_threshold" BIGINT NOT NULL DEFAULT 0,
    "currency" "currency" NOT NULL,
    "cost_per_unit" DECIMAL(18,4),
    "last_balance_sync_at" TIMESTAMPTZ(3),
    "last_health_check_at" TIMESTAMPTZ(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fulfillment_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_balance_logs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "allocation_id" UUID,
    "reason" "balance_change_reason" NOT NULL,
    "delta_available" BIGINT NOT NULL,
    "delta_reserved" BIGINT NOT NULL,
    "available_after" BIGINT NOT NULL,
    "reserved_after" BIGINT NOT NULL,
    "note" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_balance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "request_id" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "outbox_event_id" UUID,
    "order_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "event_type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "tracking_token_hash" CHAR(64) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "user_id" UUID,
    "contact_email" TEXT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'CREATED',
    "fulfillment_method" "fulfillment_method" NOT NULL,
    "currency" "currency" NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "recipient_roblox_user_id" BIGINT NOT NULL,
    "recipient_username" TEXT NOT NULL,
    "recipient_display_name" TEXT,
    "cancel_reason" "order_cancel_reason",
    "paid_at" TIMESTAMPTZ(3),
    "fulfilled_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_price_id" UUID NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "robux_amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" "currency" NOT NULL,
    "unit_price_snapshot" DECIMAL(18,2) NOT NULL,
    "unit_cost_snapshot" DECIMAL(18,2) NOT NULL,
    "line_subtotal" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_number_counters" (
    "business_date" DATE NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "order_number_counters_pkey" PRIMARY KEY ("business_date")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "idempotency_key_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "gateway" "payment_gateway_code" NOT NULL,
    "merchant_order_id" TEXT NOT NULL,
    "gateway_reference" TEXT,
    "payment_method_code" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "currency" NOT NULL,
    "gateway_fee" DECIMAL(18,2),
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "raw_status" TEXT,
    "payment_url" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "callback_count" INTEGER NOT NULL DEFAULT 0,
    "last_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "source" "webhook_source" NOT NULL,
    "event_key" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "webhook_event_status" NOT NULL DEFAULT 'RECEIVED',
    "error_code" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_cases_status_created_at_idx" ON "reconciliation_cases"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_cases_one_open_per_order_kind" ON "reconciliation_cases"("order_id", "kind") WHERE (status = 'OPEN');

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_is_active_display_order_idx" ON "products"("is_active", "display_order");

-- CreateIndex
CREATE INDEX "product_prices_product_id_effective_from_idx" ON "product_prices"("product_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_product_id_version_key" ON "product_prices"("product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_orders_order_id_key" ON "fulfillment_orders"("order_id");

-- CreateIndex
CREATE INDEX "fulfillment_orders_status_updated_at_idx" ON "fulfillment_orders"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_attempts_allocation_id_key" ON "fulfillment_attempts"("allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_attempts_client_reference_key" ON "fulfillment_attempts"("client_reference");

-- CreateIndex
CREATE INDEX "fulfillment_attempts_status_verify_deadline_at_idx" ON "fulfillment_attempts"("status", "verify_deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_attempts_fulfillment_order_id_attempt_number_key" ON "fulfillment_attempts"("fulfillment_order_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_attempts_provider_external_reference_key" ON "fulfillment_attempts"("provider", "external_reference");

-- CreateIndex
CREATE INDEX "fulfillment_attempt_status_history_attempt_id_created_at_idx" ON "fulfillment_attempt_status_history"("attempt_id", "created_at");

-- CreateIndex
CREATE INDEX "fulfillment_allocations_fulfillment_order_id_idx" ON "fulfillment_allocations"("fulfillment_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_allocations_source_id_status_idx" ON "fulfillment_allocations"("source_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gamepass_orders_order_id_key" ON "gamepass_orders"("order_id");

-- CreateIndex
CREATE INDEX "gamepass_orders_status_sla_due_at_idx" ON "gamepass_orders"("status", "sla_due_at");

-- CreateIndex
CREATE INDEX "gamepass_orders_gamepass_id_idx" ON "gamepass_orders"("gamepass_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions"("family_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_recovery_codes_user_id_code_hash_key" ON "admin_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE INDEX "login_attempts_email_hash_created_at_idx" ON "login_attempts"("email_hash", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_address_created_at_idx" ON "login_attempts"("ip_address", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_sources_name_key" ON "fulfillment_sources"("name");

-- CreateIndex
CREATE INDEX "fulfillment_sources_status_health_priority_idx" ON "fulfillment_sources"("status", "health", "priority");

-- CreateIndex
CREATE INDEX "source_balance_logs_source_id_created_at_idx" ON "source_balance_logs"("source_id", "created_at");

-- CreateIndex
CREATE INDEX "source_balance_logs_allocation_id_idx" ON "source_balance_logs"("allocation_id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_order_id_idx" ON "notifications"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_outbox_event_id_channel_recipient_key" ON "notifications"("outbox_event_id", "channel", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tracking_token_hash_key" ON "orders"("tracking_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_updated_at_idx" ON "orders"("status", "updated_at");

-- CreateIndex
CREATE INDEX "orders_contact_email_idx" ON "orders"("contact_email");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchant_order_id_key" ON "payments"("merchant_order_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_gateway_reference_key" ON "payments"("gateway", "gateway_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_one_paid_per_order" ON "payments"("order_id") WHERE (status = 'PAID');

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_event_key_key" ON "webhook_events"("source", "event_key");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "fulfillment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "fulfillment_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_attempt_status_history" ADD CONSTRAINT "fulfillment_attempt_status_history_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "fulfillment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_allocations" ADD CONSTRAINT "fulfillment_allocations_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_allocations" ADD CONSTRAINT "fulfillment_allocations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "fulfillment_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gamepass_orders" ADD CONSTRAINT "gamepass_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_2fa" ADD CONSTRAINT "admin_2fa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_balance_logs" ADD CONSTRAINT "source_balance_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "fulfillment_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_balance_logs" ADD CONSTRAINT "source_balance_logs_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "fulfillment_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_price_id_fkey" FOREIGN KEY ("product_price_id") REFERENCES "product_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

