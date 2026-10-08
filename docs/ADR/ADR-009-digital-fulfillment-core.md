# ADR-009: Digital Fulfillment Core

**Status:** Accepted (Phase 11 — Digital Fulfillment Core Adaptation)
**Related:** ADR-005 (provider port), ADR-006 (fulfillment engine), ADR-007 (inventory and routing); ARCHITECTURE.md §5, §6.4; DATABASE.md

## Context

Phases 0–10 were built for Robux. The platform will also sell Telegram Premium, Telegram Stars and Telegram accounts. These products are fulfilled in different ways:

- **Telegram accounts** are items taken from inventory and handed to the order.
- **Telegram Premium and Stars** are delivered by a provider to a Telegram user.
- **Robux** is bought for a Roblox user from a funded source balance.

The engine, inventory, routing, retries and idempotency already work and must not be rewritten. The only change needed is for the core to stop assuming every product is Robux.

## Decision

1. **Product line is the single classification.** Products carry a `product_line`: `ROBLOX_ROBUX`, `TELEGRAM_PREMIUM`, `TELEGRAM_STARS` or `TELEGRAM_ACCOUNT`. One table in code (`products/domain/product-line.ts`) derives everything else from it:

   | Product line | Platform | Fulfillment type | Recipient | Unit |
   | --- | --- | --- | --- | --- |
   | ROBLOX_ROBUX | ROBLOX | BALANCE_PURCHASE | ROBLOX_USER | ROBUX |
   | TELEGRAM_PREMIUM | TELEGRAM | RECIPIENT_FULFILLMENT | TELEGRAM_USER | PREMIUM_MONTH |
   | TELEGRAM_STARS | TELEGRAM | RECIPIENT_FULFILLMENT | TELEGRAM_USER | STAR |
   | TELEGRAM_ACCOUNT | TELEGRAM | DIGITAL_DELIVERY | none | ACCOUNT |

   A line rather than separate platform and type columns, because two lines with the same platform and type (Stars and Premium) still need separate stock. Products do not store the derived values; adding a line means adding one row to the table and one enum value.
2. **The server derives; the client supplies only the identity.**
   - The order request carries an optional `recipient`: `{robloxUsername}` or `{telegramUsername}`. It has no fulfillment type, platform or line; unknown fields are refused.
   - `resolveOrderRecipient` accepts exactly the kind the product's line requires, or none for digital delivery. Anything else is `VALIDATION_FAILED`.
   - The existing Robux request (`recipient.robloxUsername`) is unchanged.
3. **Orders snapshot what was bought.**
   - Orders store `product_line`, `platform`, `fulfillment_type` and `recipient_type`; `recipient_username` becomes nullable.
   - CHECKs keep line, platform and type consistent, require a recipient of the right kind exactly when the type needs one, allow the Roblox user id only for Roblox recipients, and allow gamepass delivery only for Robux.
   - Product edits never reach existing orders, and a product's line is locked once it has orders (like its amount and method).
   - `order_items.robux_amount` keeps its name but means units of the order's line.
4. **Strategies capture what differs between types** (`fulfillment/domain/fulfillment-strategy.ts`).
   - The engine (ADR-006) is unchanged as the orchestrator: lease, attempts, verify before retry, retries, reconciliation.
   - For each type, a strategy states whom the provider delivers to (the order's recipient, or none) and whether the provider validates that recipient first:
     - Robux (balance purchase) and Premium/Stars (recipient fulfillment) deliver to a validated recipient.
     - Accounts (digital delivery) have no recipient and nothing to validate.
   - Strategy selection is a deterministic lookup by the order's snapshot. An order whose snapshot contradicts its type fails before anything is reserved.
   - There are no product conditionals in the engine.
5. **One provider port, generalized (ADR-005).** `FulfillmentRecipient` is now `{type, identifier, externalUserId}`, `FulfillmentRequest` has `amount` (units of the line) and `recipient: … | null`, and the provider balance is `units`. The four operations and their results are unchanged. Capability-specific provider interfaces were not introduced, because no current operation is meaningless for any type.
6. **One inventory (ADR-007), partitioned by line.**
   - Sources carry `product_line`, and routing only considers sources of the order's line. Stock availability is computed per line, so Stars never make Robux available.
   - For digital delivery, each unit of a source's balance is one item. The item lifecycle maps onto the existing ledger:
     - AVAILABLE is the available balance;
     - RESERVED is an open allocation;
     - SOLD/DELIVERED is the consumed allocation and the order FULFILLED;
     - BLOCKED is a write-off adjustment or the source kill switch.
   - Individual item records, their encrypted contents and how they are handed to the customer are Phase 12. That work extends this model; it does not replace it.
7. **Backward compatibility.**
   - The migration is additive. New columns default to the Robux values, so every existing product, source and order is unchanged in meaning; the defaults remain for existing writers.
   - Queue payloads, order statuses, idempotency, retry and reconciliation are untouched.
   - The Telegram seed products are created inactive: no supplier is connected and no Telegram stock exists.

## Consequences

- Robux keeps working unchanged. Telegram products can be configured and ordered through the API. With stock and a configured provider they are fulfilled by the same engine (tested end to end with the mock).
- There is still no real provider for any line (D-01, `docs/integrations/fulfillment-provider-onboarding.md`). Production keeps `FULFILLMENT_PROVIDER=none`.
- The storefront checkout still asks only for a Roblox username. Telegram checkout screens, account item storage and delivery are Phase 12, so Telegram products should stay inactive until then.
- `robux_amount` and `totalRobux` keep their historical names and now mean units of the line. Renaming them would break API contracts for no behavioral gain.
