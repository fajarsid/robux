import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const API_ROOT = join(__dirname, '..', '..', '..');

/** Same major version as docker-compose.yml, so constraints and SQL behave identically. */
const POSTGRES_IMAGE = 'postgres:17-alpine';
const REDIS_IMAGE = 'redis:7.4-alpine';
const REDIS_TEST_PASSWORD = 'integration-test-only';

/**
 * `localhost` may resolve to ::1 first, and Docker Desktop's IPv6 port forwarding for these
 * containers is unreliable (P1001, dropped connections). Published ports always answer on IPv4,
 * so the loopback name is pinned to 127.0.0.1; any other host (e.g. a remote Docker) is kept.
 */
function reachableHost(container: StartedTestContainer): string {
  const host = container.getHost();
  return host === 'localhost' ? '127.0.0.1' : host;
}

export default async function globalSetup(): Promise<void> {
  const started: StartedTestContainer[] = [];
  try {
    const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('robux_test')
      .withUsername('robux_test')
      .withPassword('integration-test-only')
      .start();
    started.push(postgres);

    const redis = await new GenericContainer(REDIS_IMAGE)
      .withCommand(['redis-server', '--requirepass', REDIS_TEST_PASSWORD])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
    started.push(redis);

    const databaseUrl = new URL(postgres.getConnectionUri());
    databaseUrl.hostname = reachableHost(postgres);
    process.env.TEST_DATABASE_URL = databaseUrl.toString();
    process.env.TEST_REDIS_URL = `redis://:${REDIS_TEST_PASSWORD}@${reachableHost(redis)}:${redis.getMappedPort(6379)}`;

    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
        stdio: 'pipe',
      },
    );

    const state = globalThis as { __POSTGRES_CONTAINER__?: unknown; __REDIS_CONTAINER__?: unknown };
    state.__POSTGRES_CONTAINER__ = postgres;
    state.__REDIS_CONTAINER__ = redis;
  } catch (error) {
    // Jest skips globalTeardown when globalSetup throws, so stop what was started here.
    await Promise.allSettled(started.map((container) => container.stop()));
    throw error;
  }
}
