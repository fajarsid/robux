import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../src/config/app-config';
import { BullMqQueuePublisher } from '../../../src/common/queue/bullmq-queue.publisher';
import { BullMqQueueRegistry } from '../../../src/common/queue/bullmq-queue.registry';
import { defineJob } from '../../../src/common/queue/job-definition';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { OUTBOX_EVENT_JOB_PAYLOAD } from '../../../src/modules/outbox/application/outbox-routes';
import { RelayOutboxEventsService } from '../../../src/modules/outbox/application/relay-outbox-events.service';
import { PrismaOutboxRelayRepository } from '../../../src/modules/outbox/infrastructure/prisma-outbox-relay.repository';
import { asPrismaService, createTestPrisma } from '../support/test-database';
import { testProcessConfig } from '../support/test-queue';

const RELAYED_JOB = defineJob({
  queue: 'payment',
  name: 'test.outbox-event',
  payload: OUTBOX_EVENT_JOB_PAYLOAD,
});

describe('outbox relay (PostgreSQL → BullMQ)', () => {
  let prisma: PrismaClient;
  const registries: BullMqQueueRegistry[] = [];

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  afterEach(async () => {
    await Promise.all(registries.splice(0).map((r) => r.onModuleDestroy()));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Each test routes its own event type, so rows written by other tests are never touched. */
  function relayFor(eventType: string, config: AppConfig = testProcessConfig('worker')) {
    const registry = new BullMqQueueRegistry(config);
    registries.push(registry);
    const relay = new RelayOutboxEventsService(
      new PrismaOutboxRelayRepository(asPrismaService(prisma)),
      new BullMqQueuePublisher(registry),
      [{ eventType, job: RELAYED_JOB }],
    );
    return { relay, queue: registry.get('payment'), config };
  }

  function writeEvent(eventType: string, requestId: string | null = null) {
    return prisma.outboxEvent.create({
      data: {
        aggregateType: 'order',
        aggregateId: randomUUID(),
        eventType,
        payload: {},
        requestId,
      },
    });
  }

  const testEventType = () => `TEST_${randomUUID().slice(0, 8)}`;

  it('delivers a committed event as a job keyed by the event id and marks it published', async () => {
    const type = testEventType();
    const { relay, queue } = relayFor(type);
    const event = await writeEvent(type, 'req-outbox-1');

    expect(await relay.relayOnce()).toEqual({ delivered: 1, failed: 0 });

    const job = await queue.getJob(event.id);
    expect(job).toMatchObject({
      name: 'test.outbox-event',
      data: {
        payload: {
          eventId: event.id,
          eventType: type,
          aggregateType: 'order',
          aggregateId: event.aggregateId,
        },
        correlationId: 'req-outbox-1',
      },
    });
    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.publishedAt).not.toBeNull();
    expect(stored.attempts).toBe(1);
    expect(await relay.relayOnce()).toEqual({ delivered: 0, failed: 0 });
  });

  it('never sees an event before its transaction commits', async () => {
    const type = testEventType();
    const { relay, queue } = relayFor(type);
    let commit!: () => void;
    let written!: string;
    const transaction = prisma.$transaction(async (tx) => {
      const event = await tx.outboxEvent.create({
        data: { aggregateType: 'order', aggregateId: randomUUID(), eventType: type, payload: {} },
      });
      written = event.id;
      await new Promise<void>((resolve) => (commit = resolve));
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await relay.relayOnce()).toEqual({ delivered: 0, failed: 0 });
    commit();
    await transaction;
    expect(await relay.relayOnce()).toEqual({ delivered: 1, failed: 0 });
    expect(await queue.getJob(written)).toBeDefined();
  });

  it('gives concurrent relays disjoint batches and enqueues each event once', async () => {
    const type = testEventType();
    const config = testProcessConfig('worker');
    const a = relayFor(type, config);
    const b = relayFor(type, config);
    const events = await Promise.all(Array.from({ length: 20 }, () => writeEvent(type)));

    const [ra, rb] = await Promise.all([a.relay.relayOnce(), b.relay.relayOnce()]);
    const remaining = await a.relay.relayOnce();
    expect(ra.delivered + rb.delivered + remaining.delivered).toBe(20);
    expect(await a.queue.getJobCounts('wait')).toEqual({ wait: 20 });
    const published = await prisma.outboxEvent.count({
      where: { id: { in: events.map((e) => e.id) }, publishedAt: { not: null }, attempts: 1 },
    });
    expect(published).toBe(20);
  });

  it('re-delivering an event after a crash before marking it published creates no second job', async () => {
    const type = testEventType();
    const { relay, queue } = relayFor(type);
    const event = await writeEvent(type);
    await relay.relayOnce();
    // Simulates a crash between enqueue and the published_at update.
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: null } });

    expect(await relay.relayOnce()).toEqual({ delivered: 1, failed: 0 });
    expect(await queue.getJobCounts('wait')).toEqual({ wait: 1 });
  });

  it('keeps an event unpublished while Redis is unreachable and delivers it after recovery', async () => {
    const type = testEventType();
    const healthy = testProcessConfig('worker');
    const down = relayFor(
      type,
      testProcessConfig('worker', {
        QUEUE_PREFIX: healthy.queue.prefix,
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '1',
      }),
    );
    const event = await writeEvent(type);

    expect(await down.relay.relayOnce()).toEqual({ delivered: 0, failed: 1 });
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed).toMatchObject({ publishedAt: null, attempts: 1 });
    expect(failed.lastError).toEqual(expect.any(String));

    // A restarted worker (fresh relay, working Redis) resumes from the database.
    const recovered = relayFor(type, healthy);
    expect(await recovered.relay.relayOnce()).toEqual({ delivered: 1, failed: 0 });
    const delivered = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(delivered).toMatchObject({ attempts: 2, lastError: null });
    expect(delivered.publishedAt).not.toBeNull();
    expect(await recovered.queue.getJob(event.id)).toBeDefined();
  });

  it('leaves event types without a route untouched', async () => {
    const { relay } = relayFor(testEventType());
    const unrouted = await writeEvent(testEventType());
    await relay.relayOnce();
    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: unrouted.id } });
    expect(stored).toMatchObject({ publishedAt: null, attempts: 0 });
  });
});
