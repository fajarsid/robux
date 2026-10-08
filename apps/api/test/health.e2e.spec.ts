import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ReadinessReport } from '@robux/shared';
import request from 'supertest';
import { HttpExceptionFilter } from '../src/common/errors/http-exception.filter';
import { DependencyHealthService } from '../src/common/health/dependency-health.service';
import { HealthController } from '../src/modules/health/controllers/health.controller';

@Controller('boom')
class BoomController {
  @Get()
  boom(): never {
    throw new Error('SQLSTATE[42P01] relation "secret_table" does not exist');
  }
}

describe('HTTP health and error contract', () => {
  let app: INestApplication;
  let report: ReadinessReport;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController, BoomController],
      providers: [
        { provide: DependencyHealthService, useValue: { readiness: async () => report } },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns 200', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health/ready returns 200 when all dependencies are up', async () => {
    report = { status: 'ready', service: 'api', checks: { postgres: 'up', redis: 'up' } };
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });

  it('GET /health/ready returns 503 when a dependency is down', async () => {
    report = { status: 'not_ready', service: 'api', checks: { postgres: 'up', redis: 'down' } };
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body.checks.redis).toBe('down');
  });

  it('never leaks internal error details', async () => {
    const res = await request(app.getHttpServer()).get('/boom').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('SQLSTATE');
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
  });

  it('maps unknown routes to NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
