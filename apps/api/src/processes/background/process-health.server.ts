import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { DependencyHealthService } from '../../common/health/dependency-health.service';
import { READINESS_PROBES, type ReadinessProbe } from '../../common/health/readiness-probe';
import { Heartbeat } from './heartbeat';

/**
 * Minimal HTTP health endpoint for processes without an HTTP API (worker, scheduler).
 * Bound to 127.0.0.1: only the container's own Docker health check can reach it.
 *
 *   /health/live  → 200 while the process loop is ticking (heartbeat fresh)
 *   /health/ready → 200 when PostgreSQL, Redis and the process's own probes (queues) answer
 */
@Injectable()
export class ProcessHealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProcessHealthServer.name);
  private server?: Server;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dependencies: DependencyHealthService,
    private readonly heartbeat: Heartbeat,
    @Inject(READINESS_PROBES) private readonly probes: readonly ReadinessProbe[],
  ) {}

  onApplicationBootstrap(): void {
    this.server = createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/health/live') {
        const fresh = this.heartbeat.isFresh();
        send(fresh ? 200 : 503, { status: fresh ? 'ok' : 'stale', service: this.config.service });
        return;
      }
      if (req.url === '/health/ready') {
        this.dependencies
          .readiness(this.probes)
          .then((report) => send(report.status === 'ready' ? 200 : 503, report))
          .catch(() => send(503, { status: 'not_ready', service: this.config.service }));
        return;
      }
      send(404, { status: 'not_found' });
    });
    this.server.listen(this.config.healthPort, '127.0.0.1');
    this.logger.log({ event: 'health_server.started', port: this.config.healthPort });
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
