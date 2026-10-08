# ADR-010: Telegram account inventory and secure handoff

**Status:** Accepted for Phase 12 MVP  
**Date:** 2026-10-08

## Context

Phase 11 established product-derived fulfillment types and a shared source/allocation ledger. Telegram Account is an inventory-backed product, while Premium and Stars remain recipient fulfillment. Account data needs stronger protection than ordinary inventory metadata, and delivery must not leak through order lists or public tracking responses.

## Decision

- Telegram Account stock remains routed through the existing `FulfillmentSource`, deterministic routing, fulfillment allocation, and transactional source balance ledger.
- Each physical account is represented by a `DigitalInventoryItem` associated with one account product and source. The encrypted payload uses AES-256-GCM with an API-only key from `ACCOUNT_INVENTORY_ENCRYPTION_KEY(_FILE)`; only a key version is stored beside ciphertext.
- The allocation transaction reserves distinct `AVAILABLE` rows with PostgreSQL row locks and `SKIP LOCKED`; consumption marks delivered stock `SOLD`, and release restores still-reserved stock to `AVAILABLE`.
- Ordinary staff/customer list and order APIs omit ciphertext and credentials. A completed order’s owner, or a guest presenting the existing private tracking token in a rate-limited POST body, may explicitly request a no-store handoff. The operation records `DELIVERED` before returning credentials and audits only IDs/status.
- Premium and Stars use the existing provider registry, mock provider, idempotency, queue, retry, and verification flow. The mock is **MOCK / NOT PRODUCTION SUPPLIER**.

## Consequences

The database now has a protected account-item table and the API requires a dedicated encryption key. Key rotation requires re-encrypting stored payloads while preserving each item’s key version. No Telegram supplier, provisioning, or authentication automation is implemented. A mock-confirmed account fulfillment proves the internal allocation lifecycle but does not validate real-world account quality or transfer safety.
