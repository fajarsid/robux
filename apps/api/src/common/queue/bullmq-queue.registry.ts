import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { bullMqConnection } from './bullmq-connection';
import type { QueueName } from './queue-catalog';
import { withQueueTimeout } from './queue-command-timeout';

/** Owns the producer-side BullMQ `Queue` instances of a process: one per queue, closed on shutdown. */
@Injectable()
export class BullMqQueueRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(BullMqQueueRegistry.name);
  private readonly queues = new Map<QueueName, Queue>();
  private shuttingDown = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: bullMqConnection(this.config, 'producer', () => !this.shuttingDown),
        prefix: this.config.queue.prefix,
      });
      // Without a listener an emitted 'error' would crash the process.
      queue.on('error', (err: Error) =>
        this.logger.warn({
          event: 'queue.connection_error',
          queue: name,
          errorMessage: err.message,
        }),
      );
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** One cheap round-trip through the queue's own connection. */
  async ping(name: QueueName): Promise<void> {
    await withQueueTimeout(this.get(name).getWaitingCount(), `ping ${name}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      [...this.queues.values()].map(async (queue) => {
        let timeout: NodeJS.Timeout | undefined;
        const close = queue.close().catch(() => undefined);
        await Promise.race([
          close,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 2_000);
          }),
        ]);
        if (timeout) clearTimeout(timeout);
        // Graceful close can resolve while ioredis still owns reconnect timers after AUTH/errors.
        // disconnect() closes the socket synchronously; do not await its end-event promise because
        // ioredis may not emit that event while cycling through connection errors.
        void queue.disconnect().catch(() => undefined);
      }),
    );
    this.queues.clear();
  }
}
