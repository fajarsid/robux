# ADR-001: Modular Monolith with Separate Worker and Scheduler Processes

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** Engineering (Phase 0 audit)
- **Related:** ADR-002 (Docker-first), PRD §53, §91 (non-goal: unnecessary microservices)

## Context

The platform has roughly a dozen business domains (identity, products, pricing, orders, payments, fulfillment, inventory, providers, notifications, administration, audit, gamepass). Several of them must change state together in a single database transaction:

- payment confirmation → order `PAID` → outbox event (one transaction);
- inventory reservation across several sources → allocation rows → order state (one transaction);
- price snapshot → order item → order totals (one transaction).

Splitting these domains into services would turn each of those into a distributed transaction (sagas, two-phase commits, eventual consistency between money and inventory). The team is small, there is one product, and initial load is modest (single-digit orders per second at peak is a generous assumption).

At the same time, fulfillment must never run inside an HTTP request (PRD §23), workers must be scalable independently of the API, and a slow provider must not degrade checkout latency.

## Decision

Build **one NestJS codebase** (`apps/api`) organised as strict domain modules, deployed as **three process types from the same image**:

| Process     | Entrypoint          | Role                                                                    |
|-------------|---------------------|-------------------------------------------------------------------------|
| `api`       | `dist/main.js`      | HTTP API (`/api/v1`), webhooks, health. Writes DB + outbox. Never calls fulfillment providers for execution. |
| `worker`    | `dist/worker.js`    | BullMQ consumers: outbox relay, fulfillment, payment follow-up, notifications, inventory sync, reconciliation. |
| `scheduler` | `dist/scheduler.js` | Registers repeatable jobs (BullMQ job schedulers, idempotent upsert). Holds no business logic itself. |

Plus one Next.js app (`apps/web`) for the storefront, customer account and admin UI.

Module rules:

1. Each domain is a Nest module under `src/modules/<domain>/` with `controllers/` (thin HTTP), `application/` (use cases), `domain/` (entities, state machines, pure rules), `infrastructure/` (Prisma repositories, external adapters). Full conventions: `ENGINEERING_STANDARDS.md` §3.
2. Modules talk to each other only through exported application services or domain events (outbox). No module imports another module's repository or Prisma model directly.
3. Domain code has no dependency on NestJS HTTP types, Prisma client types, BullMQ or any provider SDK. Infrastructure adapts to domain interfaces, not the other way round.
4. A lint rule (`eslint-plugin-boundaries` or `dependency-cruiser`) enforces rules 2 and 3 in CI from Phase 1.

## Consequences

**Positive**

- Money, order state and inventory stay in one PostgreSQL transaction boundary. Correctness is enforced by the database, not by message choreography.
- One build, one deploy, one set of migrations. Simple local development.
- API and workers scale independently (`docker compose up --scale worker=3`) because they are separate processes.
- Clear seams: if fulfillment ever needs to become its own service, the module boundary, the outbox events and the provider interface already exist.

**Negative / accepted risks**

- A bad deploy affects all process types at once. Mitigation: the migration step runs once as a separate one-shot container; health checks gate traffic; rollback is image-tag based.
- Discipline is required to keep module boundaries clean. Mitigation: boundary lint in CI, code review checklist.
- Worker and API share a dependency graph, so the worker image carries HTTP libraries it does not use. Acceptable at this size.

## Alternatives considered

- **Microservices (orders / payments / fulfillment as separate services):** rejected. Introduces distributed transactions around money and inventory with no demonstrated scaling need. Explicitly a PRD non-goal.
- **Single process (API also runs workers):** rejected. A provider outage or stuck job would consume API event-loop capacity, and API and worker could not be scaled or restarted independently.
- **Serverless functions:** rejected. Long-running verification polling, BullMQ consumers and row-level locking fit poorly; also conflicts with Docker-first (ADR-002).
