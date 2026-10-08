import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

const BEAT_INTERVAL_MS = 5_000;
const STALE_AFTER_MS = 30_000;

/**
 * Proves the event loop is still turning. If the loop is blocked the beat stops, the
 * liveness probe fails and Docker marks the container unhealthy.
 */
@Injectable()
export class Heartbeat implements OnApplicationBootstrap, OnApplicationShutdown {
  private lastBeatAt = Date.now();
  private timer?: NodeJS.Timeout;

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.lastBeatAt = Date.now();
    }, BEAT_INTERVAL_MS);
  }

  isFresh(now = Date.now()): boolean {
    return now - this.lastBeatAt < STALE_AFTER_MS;
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}
