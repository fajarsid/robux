import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DependencyHealthService } from '../../../common/health/dependency-health.service';
import { Public } from '../../auth/http/auth-decorators';

/**
 * Mounted outside `/api/v1`. Nginx exposes `/health` and `/health/live` (no dependency details)
 * and denies `/health/ready`; Docker health checks call the container directly.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dependencies: DependencyHealthService) {}

  @Get()
  health() {
    return { status: 'ok', service: 'api' };
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.dependencies.readiness();
    if (report.status !== 'ready') {
      res.status(503);
    }
    return report;
  }
}
