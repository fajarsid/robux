import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, testDatabaseUrl } from './support/test-database';

const API_ROOT = join(__dirname, '..', '..');

const EXPECTED_TABLES = [
  'admin_2fa',
  'admin_recovery_codes',
  'audit_logs',
  'digital_inventory_items',
  'fulfillment_allocations',
  'fulfillment_attempt_status_history',
  'fulfillment_attempts',
  'fulfillment_orders',
  'fulfillment_sources',
  'gamepass_orders',
  'idempotency_keys',
  'login_attempts',
  'notifications',
  'order_items',
  'order_number_counters',
  'order_status_history',
  'orders',
  'outbox_events',
  'payments',
  'product_prices',
  'products',
  'reconciliation_cases',
  'source_balance_logs',
  'system_settings',
  'telegram_bot_updates',
  'telegram_identities',
  'telegram_orders',
  'treasury_transactions',
  'user_sessions',
  'users',
  'webhook_events',
];

const REQUIRED_UNIQUE_INDEXES = [
  'orders_order_number_key',
  'orders_tracking_token_hash_key',
  'orders_idempotency_key_key',
  'idempotency_keys_scope_key_key',
  'payments_merchant_order_id_key',
  'payments_gateway_gateway_reference_key',
  'payments_one_paid_per_order',
  'webhook_events_source_event_key_key',
  'fulfillment_orders_order_id_key',
  'fulfillment_attempts_fulfillment_order_id_attempt_number_key',
  'fulfillment_attempts_one_live_per_order',
  'fulfillment_attempts_one_delivery_per_reference',
  'fulfillment_attempts_provider_external_reference_key',
  'product_prices_product_id_version_key',
  'notifications_outbox_event_id_channel_recipient_key',
  'gamepass_orders_order_id_key',
  'reconciliation_cases_one_open_per_order_kind',
  'user_sessions_token_hash_key',
  'products_id_product_line_key',
  'fulfillment_sources_id_product_line_key',
  'treasury_transactions_idempotency_key_key',
  'treasury_transactions_provider_reference_key',
];

const REQUIRED_QUERY_INDEXES = [
  'orders_user_id_created_at_idx',
  'orders_status_updated_at_idx',
  'orders_contact_email_idx',
  'orders_status_payment_expires_at_idx',
  'order_status_history_order_id_created_at_idx',
  'payments_order_id_idx',
  'payments_status_expires_at_idx',
  'webhook_events_status_received_at_idx',
  'fulfillment_orders_status_updated_at_idx',
  'fulfillment_attempts_status_verify_deadline_at_idx',
  'fulfillment_attempts_client_reference_idx',
  'fulfillment_attempts_allocation_id_idx',
  'fulfillment_sources_product_line_status_health_idx',
  'fulfillment_allocations_source_id_status_idx',
  'fulfillment_sources_status_health_priority_idx',
  'source_balance_logs_source_id_created_at_idx',
  'outbox_events_published_at_created_at_idx',
  'audit_logs_resource_type_resource_id_created_at_idx',
  'product_prices_product_id_effective_from_idx',
  'digital_inventory_items_product_id_status_created_at_idx',
  'digital_inventory_items_source_id_status_created_at_idx',
  'digital_inventory_items_allocation_id_status_idx',
  'digital_inventory_items_order_id_status_idx',
  'treasury_transactions_status_created_at_idx',
];

const REQUIRED_CHECKS = [
  'orders_total_arithmetic',
  'orders_amounts_non_negative',
  'orders_payment_deadline_after_creation',
  'orders_idr_whole',
  'orders_order_number_format',
  'orders_tracking_token_hash_hex',
  'order_items_line_arithmetic',
  'product_prices_idr_whole',
  'payments_paid_has_timestamp',
  'payments_xtr_whole',
  'fulfillment_orders_remaining_arithmetic',
  'fulfillment_orders_lease_complete',
  'fulfillment_allocations_terminal_fully_settled',
  'fulfillment_allocations_reserved_unsettled',
  'fulfillment_allocations_settled_within_amount',
  'fulfillment_sources_failures_non_negative',
  'orders_product_line_consistent',
  'orders_recipient_matches_type',
  'orders_roblox_user_id_only_for_roblox',
  'orders_gamepass_is_robux',
  'products_gamepass_is_robux',
  'fulfillment_sources_available_non_negative',
  'fulfillment_sources_reserved_non_negative',
  'digital_inventory_items_line_check',
  'digital_inventory_items_ciphertext_check',
  'digital_inventory_items_state_check',
  'product_prices_stars_amount_positive',
  'order_items_stars_amount_snapshot_positive',
  'treasury_transactions_confirmed_at_check',
];

const APPEND_ONLY_TABLES = [
  'product_prices',
  'order_status_history',
  'fulfillment_attempt_status_history',
  'source_balance_logs',
  'audit_logs',
];

describe('database schema', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('applies every migration successfully', async () => {
    const migrations = await prisma.$queryRaw<{ migration_name: string; finished: boolean }[]>`
      SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS finished
      FROM _prisma_migrations ORDER BY migration_name`;
    expect(migrations.map((m) => m.migration_name)).toEqual([
      '20261005010000_init_schema',
      '20261005010100_integrity_constraints',
      '20261005030000_order_tax_payment_deadline_pending_recipient',
      '20261005060000_payment_attempts',
      '20261005090000_fulfillment_engine',
      '20261005100000_inventory_routing',
      '20261006010000_digital_fulfillment_core',
      '20261008090000_telegram_account_inventory',
      '20261009100000_telegram_mini_app_identity',
      '20261010100000_multi_payment_treasury',
    ]);
    expect(migrations.every((m) => m.finished)).toBe(true);
  });

  it('has no drift between the Prisma schema and the migrated database', () => {
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema',
        '--exit-code',
      ],
      { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl() }, encoding: 'utf8' },
    );
    expect({ status: result.status, stdout: result.stdout.trim() }).toEqual({
      status: 0,
      stdout: expect.stringMatching(/empty|no difference/i),
    });
  });

  it('creates exactly the 31 documented tables', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('has the required unique and query indexes', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; is_unique: boolean }[]>`
      SELECT i.indexname, ix.indisunique AS is_unique
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_index ix ON ix.indexrelid = c.oid
      WHERE i.schemaname = 'public'`;
    const unique = new Set(rows.filter((r) => r.is_unique).map((r) => r.indexname));
    const all = new Set(rows.map((r) => r.indexname));
    expect(REQUIRED_UNIQUE_INDEXES.filter((name) => !unique.has(name))).toEqual([]);
    expect(REQUIRED_QUERY_INDEXES.filter((name) => !all.has(name))).toEqual([]);
  });

  it('has the integrity CHECK constraints', async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c'`;
    const names = new Set(rows.map((r) => r.conname));
    expect(REQUIRED_CHECKS.filter((name) => !names.has(name))).toEqual([]);
  });

  it('protects append-only tables with row and truncate triggers', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; trigger_count: bigint }[]>`
      SELECT c.relname AS table_name, count(*) AS trigger_count
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgfoid = 'forbid_row_mutation'::regproc
      GROUP BY c.relname ORDER BY c.relname`;
    expect(rows.map((r) => [r.table_name, Number(r.trigger_count)])).toEqual(
      [...APPEND_ONLY_TABLES].sort().map((table) => [table, 2]),
    );
  });

  it('uses RESTRICT for every foreign key except the documented exceptions', async () => {
    const rows = await prisma.$queryRaw<{ constraint_name: string; delete_rule: string }[]>`
      SELECT tc.constraint_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
    const nonRestrict = rows
      .filter((r) => r.delete_rule !== 'RESTRICT')
      .map((r) => `${r.constraint_name}:${r.delete_rule}`)
      .sort();
    expect(nonRestrict).toEqual([
      'admin_2fa_user_id_fkey:CASCADE',
      'admin_recovery_codes_user_id_fkey:CASCADE',
      'login_attempts_user_id_fkey:SET NULL',
      'notifications_outbox_event_id_fkey:SET NULL',
      'user_sessions_user_id_fkey:CASCADE',
    ]);
  });
});
