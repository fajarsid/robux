# Fulfillment provider onboarding (D-01)

**Status (2026-10-05): BLOCKED. No authorized provider has been identified and no official API documentation has been supplied.** Production runs with `FULFILLMENT_PROVIDER=none`. Development and tests use `MockFulfillmentProvider`.

This document lists what a real provider integration requires and where it plugs in. It describes no provider API: endpoints, authentication, payloads, status values, error codes and settle windows are taken only from the provider's official documentation, saved next to this file (as `docs/integrations/duitku.md` is for payments) before any code is written.

## 1. Required before any code

| Item | Needed from | Status |
| --- | --- | --- |
| Provider name and legal/commercial agreement for this use | Product owner (D-01) | Not provided |
| Official API documentation (fulfil, status/verify, balance, recipient validation, errors) | Provider | Not provided |
| Written confirmation the method is authorized (no customer credentials, no Roblox cookies/sessions, no CAPTCHA/MFA bypass, no undocumented Roblox APIs; R-01) | Provider and product owner | Not provided |
| Authentication mechanism and sandbox credentials | Provider | Not provided |
| Client-supplied idempotency reference: supported? scope? retention? | Provider docs | Unknown |
| Status visibility / settle window for "not found" | Provider docs | Unknown |
| Rate limits (per second/minute, concurrency) | Provider docs | Unknown |
| Webhooks: events, signature scheme, retries | Provider docs | Unknown |
| Sandbox environment and test recipients | Provider | Unknown |

A provider that needs the customer's Roblox password, cookie, session, MFA code or CAPTCHA answer is incompatible with the platform's security model (SECURITY.md §6) and is not integrated.

## 2. Where it plugs in (already built)

- **Port:** `modules/fulfillment/domain/fulfillment-provider.ts` (`getBalance`, `validateRecipient`, `fulfill`, `verify`, normalized `ProviderErrorCode`). The port is not changed to fit a provider; the adapter maps.
- **Adapter location:** `modules/fulfillment/infrastructure/providers/<provider>/`, with a transport client (HTTP, auth, timeout, raw formats) separate from the adapter (mapping, error normalization, idempotency semantics). Provider types never leave this folder.
- **Registration:** `infrastructure/configured-providers.ts` creates the adapter from validated configuration. It is wrapped by `ObservedFulfillmentProvider` (logs and redaction) and resolved through `FulfillmentProviderRegistry` by `fulfillment_sources.provider`. An unknown code is never substituted.
- **Configuration:** the provider gets its own `config/<provider>-config.ts`, following `fulfillment-config.ts` and `payments-config.ts`. Secrets are read with `readSecret` from Docker secrets (`secrets/`, `*_FILE`) and never placed in `.env`, logs, API responses or source.
- **Inventory:** a `fulfillment_sources` row with the adapter's provider code. It is created DISABLED through `/console/inventory`, with its credential stored as a secret *name* in `credential_ref` (`sources.credentials.manage`, never returned by any API). Routing, reservation, cost snapshot, health and the kill switch apply unchanged (ADR-007).
- **Engine:** no changes. Retries, verify-before-retry, the lease, allocation consumption and release stay where they are (ADR-006). The adapter makes one provider call per operation and never retries business operations itself.
- **Tests:** `test/contracts/fulfillment-provider.contract.ts` runs against the adapter (sandbox) next to the mock. The mock suite stays.

## 3. Requirements the adapter must meet

1. HTTPS only, with TLS verification on. Redirects are not followed. Response size is bounded and responses are schema-validated.
2. The base URL comes from configuration only and must match the configured environment. Production credentials are accepted only with the production URL, and sandbox credentials are refused when `NODE_ENV=production`. A mismatch fails startup.
3. Request timeout is well below the 90 s fulfillment lease (`FULFILLMENT_LEASE_MS`), validated at startup.
4. A timeout or transport error during `fulfill` returns `UNKNOWN`, never a failure.
5. `clientReference` maps to the provider's idempotency/reference field, and the provider reference is returned for `verify`.
6. Rate-limit responses map to `RATE_LIMITED` and are retried by the engine; the adapter adds no retry framework.
7. Webhooks, if documented, are signature-verified per the official scheme. They are deduplicated durably (`webhook_events`) and validated against the stored attempt (references, amount, order state). A conflict goes to reconciliation and never forces a transition.
8. Only reference, recipient (username, user ID if required) and amount are sent. No email, contact data, payment data or tracking token.
9. Logs carry provider, operation, references, normalized status, error code, duration and correlation id. They never carry keys, tokens, signatures or raw payloads.

## 4. Known engine gap a real provider may need

Verification `NOT_FOUND` currently makes a request retry-eligible immediately (ADR-006). That is correct for the mock and for providers whose status lookup is immediately consistent. If the provider's documentation describes delayed visibility, a per-provider settle window must be added before production: the adapter declares it, and the engine keeps treating `NOT_FOUND` as "not yet known" until the window has passed since the attempt started. This must be built from the documented value, not a guessed one.

## 5. Production gate

Production fulfillment stays off (`FULFILLMENT_PROVIDER=none`, source DISABLED) until all of these hold:

- authorization confirmed in writing;
- production credentials stored as Docker secrets;
- production base URL verified;
- webhook configured (if any);
- idempotency verified in sandbox;
- verification verified in sandbox, including the timeout case;
- timeout and rate limits verified;
- security review passed;
- rollback procedure rehearsed.

**Rollback / kill switch:** deactivate the source in `/console/inventory` (`status=DISABLED`, audited) to stop new allocations. Existing allocations finish through verification or go to reconciliation. Nothing is deleted. Removing the provider from `FULFILLMENT_PROVIDER` additionally stops the worker from calling it; open attempts then wait for verification once it is back.
