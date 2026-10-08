# ADR-005: Fulfillment provider adapters behind one port

**Status:** Accepted (Phase 8)
**Related:** ARCHITECTURE.md §6.4, §6.4a; SECURITY.md §6 (R-01); IMPLEMENTATION_PLAN.md D-01; ADR-004

## Context

Robux are delivered by a fulfillment provider. No authorized provider exists yet (D-01), and R-01 forbids any unofficial Roblox integration. The fulfillment engine (Phase 9) still has to be built and tested against realistic provider behaviour: delayed outcomes, partial deliveries, transient and permanent failures, and timeouts after which nobody knows whether Robux were sent.

## Decision

1. **One port** (generalized in Phase 11, ADR-009: typed recipient or none, `amount` and `units` in the product line's unit). `modules/fulfillment/domain/fulfillment-provider.ts` defines `FulfillmentProvider`: `getBalance()`, `validateRecipient()`, `fulfill()` and `verify()`. Requests and results are typed (`FulfillmentRequest`, `FulfillmentResult`, `VerificationResult`, `ProviderBalance`, `RecipientValidation`) and errors are normalized `ProviderErrorCode` values. Amounts are Robux units, never money. The engine depends on the port only.
2. **Idempotency at the provider.** Every `fulfill` carries a client reference chosen by us, one per request (amended by ADR-006: retries of an undelivered request reuse it). Repeating it must never deliver again: the provider returns the outcome of the first call. Reusing it for a different amount or recipient is refused with `DUPLICATE_REFERENCE`. Providers are chosen for support of a client reference (IMPLEMENTATION_PLAN.md, risks).
3. **Verify before retry.** `UNKNOWN` (timeout, crash) means "may have executed". The engine never re-executes an UNKNOWN attempt; it calls `verify({ clientReference })`, which answers `SUCCEEDED`, `PARTIAL`, `PENDING`, `FAILED`, `NOT_FOUND` (nothing was delivered) or `UNAVAILABLE` (still unknown, ask again).
4. **Registry, no fallback.** `FulfillmentProviderRegistry` maps `fulfillment_sources.provider` codes to adapters. An unknown code throws `ProviderNotConfiguredError`; nothing ever substitutes another provider. Adapters are created in `infrastructure/configured-providers.ts` only, from configuration, and each is wrapped by `ObservedFulfillmentProvider`, which logs every call (provider, operation, client and provider reference, status, error code, duration, correlation id) without recipient data.
5. **Mock provider.** `MockFulfillmentProvider` (`code = mock`) is a deterministic simulator for development and tests. It calls nothing external. An explicit scenario decides the outcome for new client references: `SUCCESS`, `PENDING` (settled later by the test), `PARTIAL`, `RETRYABLE_FAILURE`, `PERMANENT_FAILURE`, `SUCCEEDED_BUT_TIMED_OUT`, `INVALID_RECIPIENT`, `UNAVAILABLE`. Fixed recipients `mock-valid-user`, `mock-invalid-user` and `mock-unavailable-user` behave the same under every scenario. An in-memory ledger keeps one record per client reference, so repeats and concurrent calls produce one simulated delivery and `verify` answers truthfully. Its balance is configurable; a delivery above it is a retryable `INSUFFICIENT_BALANCE` without effect. It is not a Roblox fulfillment provider.
6. **Configuration and production gate.** `FULFILLMENT_PROVIDER=none|mock` (default `none`), with `MOCK_FULFILLMENT_BALANCE` and `MOCK_FULFILLMENT_SCENARIO`. Every process (api, worker, scheduler) loads it. `NODE_ENV=production` with `mock` fails configuration loading, so no process starts. Any other provider name also fails: an unavailable real provider never degrades to the mock.
7. **Contract suite.** `apps/api/test/contracts/fulfillment-provider.contract.ts` states the behaviour every adapter must have (balance shape, verify by reference, no double delivery, duplicate-reference refusal, NOT_FOUND for unknown references, invalid input rejected without effect). The mock runs it now; an authorized adapter runs it against its sandbox before it is enabled.

## Consequences

- The fulfillment engine never knows which adapter it talks to; switching to an authorized provider is a new adapter plus configuration.
- The mock ledger lives in the worker's memory: a worker restart forgets simulated deliveries, so `verify` then answers `NOT_FOUND` for them. Acceptable for development and tests; a real provider keeps its own records.
- The mock's provider references carry a per-process prefix (`MOCK-<random>-000001`) in a running worker, so a restart does not reuse references (`UNIQUE(provider, external_reference)`); tests construct it with the plain `MOCK` prefix.
- The scenario applies to the whole mock instance. Per-source behaviour (several mock sources with different scenarios) is left to Phase 10 if routing tests need it.
