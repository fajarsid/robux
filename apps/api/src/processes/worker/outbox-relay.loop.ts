import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  OUTBOX_RELAY_BATCH_SIZE,
  RelayOutboxEventsService,
} from '../../modules/outbox/application/relay-outbox-events.service';

const IDLE_POLL_MS = 1_000;
const MAX_FAILURE_BACKOFF_MS = 30_000;

/**
 * Polls the outbox in the worker process. Several workers may poll at once (`--scale worker=N`):
 * `SKIP LOCKED` gives each a disjoint batch. Failures back off exponentially but never stop the
 * loop, so events committed during a Redis outage are delivered once Redis returns.
 */
@Injectable()
export class OutboxRelayLoop implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayLoop.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private failureBackoffMs = 0;

  constructor(private readonly relay: RelayOutboxEventsService) {}

  onApplicationBootstrap(): void {
    if (!this.relay.hasRoutes()) {
      this.logger.log({ event: 'outbox.relay_idle', reason: 'no_routes' });
      return;
    }
    this.schedule(0);
    this.logger.log({ event: 'outbox.relay_started' });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
      });
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.relay.relayOnce();
      if (result.failed > 0) {
        this.backOff();
        return;
      }
      this.failureBackoffMs = 0;
      this.schedule(result.delivered >= OUTBOX_RELAY_BATCH_SIZE ? 0 : IDLE_POLL_MS);
    } catch (error) {
      this.logger.error({ event: 'outbox.relay_failed', err: error });
      this.backOff();
    }
  }

  private backOff(): void {
    this.failureBackoffMs = Math.min(
      Math.max(this.failureBackoffMs * 2, IDLE_POLL_MS),
      MAX_FAILURE_BACKOFF_MS,
    );
    this.schedule(this.failureBackoffMs);
  }
}
