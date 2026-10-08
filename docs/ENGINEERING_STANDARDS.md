# Engineering Standards

**Status:** Permanent. Applies to every phase, feature and file unless superseded by an ADR in `docs/ADR/`.
**Related:** `ARCHITECTURE.md` (what the system is), `SECURITY.md` (security controls), ADR-001 (modular monolith), ADR-002 (Docker-first).

Every implementation must follow this document. When a rule here conflicts with convenience, the rule wins; when it conflicts with a real constraint, write an ADR instead of silently deviating.

---

## 1. Principles

1. **One place to look.** For any feature, the folder structure answers "where do I change this?".
2. **High cohesion, low coupling.** Related code lives together; unrelated code is separated.
3. **One authoritative implementation** per business rule, per UI primitive, per utility.
4. **Traceable.** A reader can follow a feature from UI to database, and an async flow from API to provider, without hidden coupling or magic.
5. **No god files.** A file has one clear responsibility. Splitting is driven by responsibility, not by line count, and trivial code is not split into meaningless micro-files.
6. **Refactor while you are there.** If the code you are changing has mixed responsibilities or has grown too large, fix it as part of the change. No unrelated mass refactors.

---

## 2. Repository layout

```text
apps/api        NestJS: HTTP API, worker and scheduler processes (one codebase, three entrypoints)
apps/web        Next.js storefront, customer account, admin UI
packages/shared Contracts shared by api and web: DTO schemas, enums, error codes. No business logic.
infra/          Dockerfiles, Nginx, Redis config
scripts/        Operational scripts (secrets, checks, cert generation)
docs/           PRD, architecture, security, deployment, ADRs, these standards
```

---

## 3. Backend (apps/api)

### 3.1 Structure

```text
apps/api/src/
├── main.ts / worker.ts / scheduler.ts   process entrypoints only (bootstrap, no logic)
├── config/                              environment loading and validation
├── common/                              genuinely shared infrastructure (see 3.3)
├── processes/                           non-HTTP process runtimes (worker, scheduler)
├── seed/                                development seed data and runner (never runs in production)
├── cli/                                 operator commands run inside the API image (e.g. create-staff-account)
├── generated/                           Prisma client output (git-ignored, regenerated on build)
└── modules/
    ├── health/
    ├── auth/
    ├── products/
    ├── pricing/
    ├── orders/
    ├── payments/
    ├── fulfillment/
    ├── inventory/
    ├── notifications/
    ├── administration/
    └── audit/
```

### 3.2 Inside a module

```text
modules/orders/
├── orders.module.ts
├── controllers/        HTTP only: validate input, call one use case, map the result
├── http/               cross-cutting HTTP concerns owned by the module (auth: guards, decorators, cookie handling)
├── dto/                request/response shapes (zod schemas from packages/shared where shared with web)
├── application/        use cases, one per operation: create-order.service.ts, cancel-order.service.ts
├── domain/             entities, value objects, policies, state machines. Pure TypeScript:
│                       no NestJS HTTP types, no Prisma, no BullMQ, no provider SDKs
└── infrastructure/     repositories (Prisma), external adapters (e.g. duitku-payment.gateway.ts)
```

Exception: `domain/` may import the generated enum constants from `src/generated/prisma/enums` (plain string constants generated from the schema, no client or runtime). This keeps one definition of each status set instead of duplicating it by hand. Domain code never imports the Prisma client.

Create only the folders a module actually needs. A module with one controller and one service does not need five empty folders.

Rules:

- **Controllers are thin.** No business branching, no transactions, no Prisma.
- **Use cases own transactions** and orchestrate domain logic and repositories.
- **Database access lives only in repositories** inside `infrastructure/`. No Prisma calls in controllers, use cases or domain code.
- **External providers live behind ports** defined in `domain/` (e.g. `PaymentGateway`, `FulfillmentProvider`) and implemented in `infrastructure/`. Business code never imports a provider SDK or a provider-specific adapter.
- **Modules talk through exported application services or outbox events**, never through another module's repository or tables.
- **Async work** follows: use case → DB transaction + outbox row → relay → BullMQ → worker consumer → use case. Job payloads carry ids only.

### 3.3 `common/`

Only infrastructure that more than one module or process genuinely uses: database client, Redis client, logging, error filter, dependency health, process lifecycle. **No domain logic in `common/`**, and no `utils/` or `helpers/` dumping grounds. If something is used by one module, it lives in that module.

---

## 4. Frontend (apps/web)

### 4.1 Structure

```text
apps/web/
├── messages/                 i18n catalogs (id.json is the default locale, D-09)
└── src/
    ├── app/                  Next.js routes: compose features, no business logic
    ├── components/
    │   ├── ui/               design-system primitives: Button, ButtonLink, Input, Card, Badge, Dialog, DataTable…
    │   ├── layout/           page shells, SiteHeader, SiteFooter
    │   ├── feedback/         LoadingState, ErrorState, EmptyState, toasts
    │   └── forms/            form field wrappers
    ├── features/
    │   └── <feature>/        landing, products, checkout, orders, payments, account, tracking, admin-*
    │       ├── components/   feature-specific components (CheckoutForm, OrderSummary)
    │       ├── hooks/        useCheckout, useOrderTracking
    │       ├── services/     API calls for the feature (checkoutService)
    │       └── types/
    ├── hooks/                cross-feature React hooks (useApiAction: idle/loading/success/error)
    ├── lib/                  cross-feature infrastructure: lib/api (browser and server API clients), lib/format (the one money/number/date formatter)
    ├── i18n/                 next-intl configuration
    └── config/               runtime configuration
```

### 4.2 Component rules

- **Pages compose, components present, hooks orchestrate, services call the API.**
  `page → FeatureComponent → useFeature() → featureService → API`.
- Components contain no pricing, eligibility, status or allocation rules. They render what the API returns.
- **Reuse before you write.** Any UI pattern used twice (buttons, cards, badges, status indicators, price display, loading/error/empty states, tables, dialogs) becomes a component in `components/ui` or `components/feedback`, or in the feature's `components/` if it is feature-specific. Do not abstract a pattern that appears once.
- Every API interaction exposes `idle | loading | success | error` states using the shared feedback components.
- **No hard-coded user-facing text.** All strings come from `messages/<locale>.json` via `next-intl`. Default language: Bahasa Indonesia, professional and natural.

### 4.3 Design system

- Tokens (color, typography, spacing, radius, shadow) are defined once in `src/app/globals.css` (`--ds-*` variables mapped by Tailwind `@theme inline`). Pages and components use semantic token classes (`bg-surface`, `text-muted-foreground`, `border-border`, `rounded-card`, `shadow-overlay`), never raw hex values, palette classes (`zinc-800`) or one-off arbitrary values.
- Variants (primary/secondary, sizes, states) live in the primitive, not in each call site.
- The same primitives are used across landing, products, checkout, tracking, account and admin.

### 4.4 Console UI standard (Phase 7.1, binding for Phases 8–18)

Every new console screen is assembled from the components below. **No feature may introduce its own table, pagination, modal, button, icon system, sidebar, toast, form field or theme implementation**; if a pattern is missing, extend the canonical component.

| Pattern | Canonical component |
| --- | --- |
| Tables | `components/data-display/DataTable` (+ `useClientPagination` for lists the API returns whole; URL state for server-paged lists) |
| Pagination, page size | `Pagination`, `PageSizeSelect`, `pagination-model` (`PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE`), used through DataTable only |
| Overlays | `components/ui/Dialog` (native `<dialog>`; centred or `placement="left"` drawer) |
| Create / edit forms | `components/ui/FormDialog` |
| Confirmations | `components/ui/ConfirmDialog` (`tone="danger"` for destructive actions) |
| Row and menu actions | `components/ui/DropdownMenu` |
| Buttons | `Button`, `ButtonLink`, `IconButton` (`button-styles.ts`) |
| Icons | `components/ui/Icon` (Iconsax) |
| Form controls | `components/forms` (FormField, TextField, SelectField, TextareaField, PasswordField) |
| Status | `components/data-display/StatusBadge` (tones success / progress / attention / danger / neutral / info) |
| Feedback | `components/feedback` (Alert, ApiErrorAlert, EmptyState, Skeleton, Toast) |
| Page chrome | `components/layout` (PageHeader, Breadcrumb, Panel); `features/console/components` (ConsoleShell, ConsoleNav, ConsoleTopbar, UserMenu, ThemeSwitcher) |

**Tables.** Every console list is a DataTable:

- First column "No." (`common.table.number`), counting across pages: `(page − 1) × pageSize + index + 1`.
- Footer: "Tampilkan" page-size select (10 / 25 / 50 / 100, default 10) and the range summary at the bottom left; Pagination (previous, numbered pages with gaps, next) at the bottom right. Changing the page size returns to page 1.
- States: `loading` renders Skeleton rows, `error` an Alert, `empty` an EmptyState instead of an empty table.
- Row actions go in the `actions` column (a DropdownMenu with an IconButton trigger named "Tindakan untuk …"); the header of that column is screen-reader only.
- Phones: pass `mobileCard`; the table is hidden below `md` and a numbered card list is shown instead. No horizontal page scroll at 390 px; wide tables scroll inside their own container.

**CRUD.**

- Create and edit share one field component (e.g. `ProductFields`) and open in a FormDialog; there are no separate create/edit pages.
- Multi-step forms (new price: edit, then review) stay in one FormDialog and use `onCancel` to go back.
- Status changes and anything destructive go through ConfirmDialog; nothing is changed or deleted straight from a click.
- Dialogs block dismissal while their request runs (`busy` / `submitting`), show API errors inline with ApiErrorAlert, close on success, then toast and `router.refresh()`.
- No delete endpoints exist today; when one is added it uses ConfirmDialog with `tone="danger"`.

**Buttons.**

- Variants: `primary` (one main action per view), `secondary`, `outline` (secondary actions, cancel), `ghost` (toolbar, icon buttons), `danger` (destructive), `link`.
- Sizes: `sm` (h-8, tables and menus), `md` (h-10, forms, dialogs, page headers), `lg` (storefront only).
- Every `<button>` states its `type`; Button and IconButton default to `type="button"`.
- An icon-only button is an IconButton with a required `label` (accessible name and tooltip).

**Icons.**

- Iconsax (`iconsax-react`, exact version pinned) is the only icon set, imported only in `components/ui/Icon.tsx`.
- Features use semantic names (`orders`, `edit`, `refresh`, …); add a name to `ICONS` when a new meaning is needed.
- Variant `linear` by default, `bold` for the active navigation item only. Sizes `xs` 14, `sm` 16, `md` 20, `lg` 24.
- Icons are decorative (`aria-hidden`) unless given a `label`. No inline SVGs, emoji or other icon libraries.

**Sidebar.**

- Fixed sidebar from `lg`, a left drawer (Dialog `placement="left"`) below it, with no border between the sidebar and the content.
- The active item uses a background (`bg-muted`), semibold foreground text and a bold `text-primary` icon, never a border or stripe.
- Items come from `features/console/navigation.ts` and show only screens with a backend.

**Theme.**

- Console themes: Light, Dark (default) and System, chosen in the topbar ThemeSwitcher.
- The choice is stored in the non-sensitive `console-theme` cookie, read on the server so the page renders without a flash, and applied as `data-theme` on `#console-root`.
- Semantic tokens: `background`, `foreground`, `surface`, `surface-muted`, `muted`, `muted-foreground`, `border`, `primary`, `primary-hover`, `primary-foreground`, `secondary`, `success`, `warning`, `danger`, `info`, `overlay`, `ring`.
- Dark mode avoids pure black and pure white (background `#0a0a0b`, foreground `#f4f4f5`); light mode uses a darker gold primary for contrast.
- The storefront stays dark.

**Typography and spacing.**

- Poppins (`font-console`) for the whole console.
- Text sizes: page title `text-2xl font-semibold`, panel and dialog titles `text-lg font-semibold`, body `text-sm`, captions and meta `text-xs`, section labels `text-2xs uppercase`.
- Radii: `rounded-control` (controls), `rounded-card`, `rounded-panel` (panels, menus, dialogs). Shadows: `shadow-overlay` for floating layers only.
- Spacing on the 4 px grid: page sections `gap-6`, panel padding `p-5`/`p-6`, form fields `gap-4`.

**Responsive and accessibility.**

- Every console page is checked at 1440, 1280, 1024, 768 and 390 px in light and dark with no horizontal overflow.
- Everything is keyboard operable with a visible focus ring (`--ds-ring`).
- Dialogs trap focus and return it to the opener; menus support arrow keys, Home/End and Escape.
- Inputs have labels, and required fields set `required` and show an `aria-hidden` asterisk.
- Live regions are used for toasts and copy feedback.
- Out of scope: `OrderStatusTabs` is a tab filter (pressed buttons), not a table; the storefront `QuantitySelector` keeps its own large stepper buttons.

---

## 5. Business logic ownership

The backend is the only source of truth for: prices and totals, discounts and fees, payment status, order status and transitions, fulfillment allocation, inventory reservation, gamepass gross-up, refund amounts and eligibility rules.

The frontend may validate for UX (required fields, formats) but every rule is re-validated by the backend. A business rule has exactly one implementation, in the owning module's `domain/` or `application/` layer.

---

## 6. Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Backend files | kebab-case with a role suffix (NestJS convention) | `create-order.service.ts`, `payment-callback.controller.ts`, `duitku-payment.gateway.ts` |
| Backend classes | PascalCase, explicit role | `CreateOrderService`, `PaymentCallbackController`, `DuitkuPaymentGateway`, `FulfillmentAllocationService` |
| React component files | PascalCase, one main component per file | `OrderStatusBadge.tsx`, `CheckoutSummary.tsx` |
| Hooks | `useX` in `useX.ts` | `useGuestOrderTracking.ts` |
| Next.js route files | Next.js conventions | `page.tsx`, `layout.tsx`, `route.ts` |
| Tests | next to the unit (`*.spec.ts`); API-level tests in `apps/api/test` | `order-state-machine.spec.ts` |

Avoid vague names: `Helper`, `Manager`, `Handler`, `Processor`, `Utils`, `Common`, `Data`, `Misc`, bare `Service`, unless the word is the precise role (e.g. a BullMQ job processor that is literally a processor).

---

## 7. Shared code

- Before creating a utility, component or service, search for an existing one. One canonical implementation per concern (one money formatter, one date formatter, one API client).
- `packages/shared` holds contracts only: types, zod schemas, enums, error codes. No business rules, no framework code.
- Duplicates found during a change are merged as part of that change.

---

## 8. Comments

Comments explain **why**, not **what**. Write them for:

- non-obvious business rules and invariants;
- security constraints;
- concurrency and idempotency reasoning;
- provider-specific behaviour;
- unusual workarounds and the reason for them.

Do not write comments that restate the code, describe obvious parameters, or repeat project-wide rules. Project rules live here, not in source files. Prefer better names over explanatory comments.

---

## 9. Error handling

- API errors are `{ code, message, requestId }` with codes from `packages/shared` (`ErrorCode`). Stack traces, SQL errors and provider responses are logged, never returned.
- Domain errors are typed and mapped to HTTP status in one place (the global filter or a module's error mapping).
- Customer-facing copy for each code lives in the frontend message catalog.
- Never swallow errors silently. Either handle them meaningfully or let them propagate.

---

## 10. Logging

- Structured JSON via pino. Event names are dot-separated and stable: `order.created`, `payment.callback_rejected`, `fulfillment.attempt_unknown`.
- Always include the correlation fields that apply: `requestId`, `orderId`, `paymentId`, `jobId`, `attemptId`, `providerReference`.
- Never log secrets, tokens, passwords, cookies, authorization headers, signatures or customer credentials. Redaction is centralised in `common/logging/redact.ts`; extend it there.

---

## 11. Security conventions

`SECURITY.md` is authoritative. In code: validate every input at the boundary, check object ownership in use cases, keep secrets out of logs and job payloads, use parameterised queries only, and never implement anything excluded by R-01.

---

## 12. Testing

- Business rules (pricing, state machine, routing, reservation, idempotency, retry) have unit tests in `domain/`/`application/`.
- Repositories and concurrency-sensitive code have integration tests against real PostgreSQL/Redis (Testcontainers): `apps/api/test/integration/*.int-spec.ts`, run with `pnpm --filter @robux/api test:integration` (needs Docker). Tests share one database per run and create uniquely keyed data instead of cleaning up, because append-only tables cannot be truncated.
- Frontend components with behaviour (forms, selectors, data display) have Vitest + Testing Library tests next to them (`*.test.tsx`), rendered with the real Indonesian message catalog (`src/test/render-with-intl.tsx`) so missing message keys fail tests.
- Critical flows have E2E tests (Playwright for web, supertest for API).
- Tests describe behaviour (`rejects a duplicate payment callback`), not implementation.

---

## 13. Dependencies

- Add a dependency only with a concrete need; prefer the platform or an existing dependency.
- Pin major versions; the lockfile is committed and installs use `--frozen-lockfile`. Pre-1.0 packages (e.g. `iconsax-react`) are pinned to an exact version.
- Respect the layer direction: `controllers → application → domain ← infrastructure`. `domain/` imports nothing from the other layers.

---

## 14. Before writing code

1. Find the owning module/feature.
2. Look for existing components, services and utilities to reuse.
3. Follow the existing naming conventions.
4. Check whether the business rule already exists.
5. Decide the layer: frontend presentation, backend application, domain, infrastructure or shared contract.
6. Implement in the smallest appropriate boundary.

---

## 15. Phase quality gate — structural review

Before a phase is declared complete, in addition to the technical gate (build, lint, typecheck, tests, Docker, health):

- [ ] Responsibilities clearly separated; no god files or components
- [ ] No duplicated components, utilities or business rules
- [ ] Folders follow sections 3 and 4; feature boundaries are clear
- [ ] Frontend uses design-system primitives and tokens; no hard-coded visual values or text
- [ ] Business logic is outside presentation components and controllers
- [ ] Comments are minimal and explain why
- [ ] Names are explicit
- [ ] A new developer can trace each feature end to end
- [ ] Documentation matches the implementation

If any item fails, refactor before declaring the phase complete.

---

## 16. Version control

During the current development stage nothing is committed, pushed, merged, tagged or rebased without explicit approval from the project owner. Destructive git operations (`reset --hard`, `clean -fd`) are never run without approval. Each phase report includes the git status (modified/new/deleted/untracked files, commits created, pushes performed).
