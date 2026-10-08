# ADR-004: BullMQ queues fed by a transactional outbox

**Status:** Accepted (Phase 7 foundation; first route and consumer added in Phase 7)
**Related:** ARCHITECTURE.md §3, §6.3, §6.6, §6.8; ENGINEERING_STANDARDS.md §3.2; ADR-002 (Docker-first)

## Context

Payment confirmation, fulfillment, notifications and reconciliation run asynchronously, outside the HTTP request. PostgreSQL is the source of truth. Redis can restart or lose data, and every job can be delivered more than once: after a crash, a stalled lock, an outbox re-delivery or an operator retry.

## Decision

1. **Queue technology.** BullMQ 5 on the existing Redis (AOF, `noeviction`, password, internal `data` network). BullMQ 5.81 pins the same `ioredis` version the API already uses, so the process has one Redis client library. BullMQ 6 changes its peer dependencies and was not adopted.
2. **Processes.** The `worker` container consumes jobs and runs the outbox relay. The `scheduler` container only registers BullMQ job schedulers and executes nothing. The API enqueues nothing directly; it writes outbox rows inside its transactions.
3. **Abstraction.** Application code depends on `QueuePublisher` (`common/queue/queue-publisher.ts`) and `JobProcessor` (`common/queue/job-processor.ts`). Each job is a `JobDefinition`: queue, stable dot-separated name (`payment.expiry-sweep`), zod payload schema and an optional retry override. BullMQ types stay inside `common/queue` and `processes/worker`.
4. **Payloads.** Flat records of identifiers and scalars, validated on publish and on consume. Keys that look like credentials (`password`, `token`, `cookie`, `secret`, `apiKey`, `signature`, `totp`, `recovery`, ...) are rejected. Processors load state from PostgreSQL.
5. **Outbox relay.** `RelayOutboxEventsService` locks unpublished rows with `FOR UPDATE SKIP LOCKED` in creation order, publishes each with `jobId = outbox_events.id` and `correlationId = request_id`, and then sets `published_at` in the same transaction. A failed publish increments `attempts`, records `last_error` and stops the batch. The relay delivers only event types listed in `OUTBOX_ROUTE_TABLE`; other events stay unpublished until the phase that adds their consumer also adds the route. The first route is `PAYMENT_CONFIRMED` → `order.payment-confirmed` on the `order-processing` queue (ARCHITECTURE.md §6.3).
6. **Retries.** Each queue has a default `RetryPolicy` (ARCHITECTURE.md §6.6: 5 s, 15 s, 30 s, 60 s, 5 min, at most 5 runs, ±20 % jitter). A job definition can override it. Delays come from one custom backoff strategy. A processor throws `NonRetryableJobError` when another run cannot help, and the job then fails immediately. Failed jobs are kept 7 days (completed jobs 1 hour) so their id, name, queue, attempts, failure reason, timestamps and correlation id can be inspected.
7. **Idempotency.** Deterministic job ids prevent duplicate jobs only while BullMQ retains the job record. Business idempotency stays in PostgreSQL: conditional updates, unique constraints and claims. Every processor must tolerate running more than once for the same payload.
8. **Schedules.** `processes/scheduler/job-schedules.ts` lists every repeating job. The scheduler upserts each one with the job name as scheduler id and removes any schedule no longer listed, so restarts or a second scheduler cannot double-schedule. The Phase 5 in-process expiry interval has been removed. `payment.expiry-sweep` (every 60 s, no retry, because the next run is the retry) is now the only trigger of `ExpireUnpaidOrdersService`.
9. **Shutdown.** On SIGTERM or SIGINT the worker pauses (no new jobs), waits up to `WORKER_SHUTDOWN_TIMEOUT_MS` (default 25 s, below the 30 s `stop_grace_period`) for active jobs, then closes. A job interrupted at the timeout stops renewing its lock and is re-delivered by BullMQ's stalled-job check. Nest destroys the process module before `QueueModule` and the global PostgreSQL and Redis clients, so consumers stop before their dependencies close.
10. **Failure bounds.** BullMQ waits indefinitely for a connection, so producer calls (publish, schedule upsert, health ping) are bounded by `QUEUE_COMMAND_TIMEOUT_MS` (5 s). The outbox relay and the scheduler retry with exponential backoff (up to 30 s) and never give up.
11. **Environment isolation.** Development and production are separate Compose projects (`robux-dev`, `robux-prod`), each with its own Redis container, volume and internal network. A worker can only reach its own environment's Redis. `QUEUE_PREFIX` (default `bull`) exists for test isolation and is not an isolation mechanism between environments.

## Consequences

- A paid order cannot be lost to a Redis outage: the event stays in `outbox_events` until a publish succeeds.
- The outbox relay adds up to about 1 s of latency (poll interval) between commit and enqueue.
- Adding a queue means one entry in `queue-catalog.ts`. Adding a job means a `JobDefinition`, a `JobProcessor` registered in `WorkerModule`, and either an outbox route or a schedule.
- Published outbox rows are not pruned yet (retention job pending).
- Readiness of `worker` includes `queue_consumers` (every BullMQ worker running and connected). Readiness of `scheduler` includes `job_schedules` (registered and the queue reachable).
