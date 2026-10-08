import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
  const state = globalThis as {
    __POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
    __REDIS_CONTAINER__?: StartedTestContainer;
  };
  await Promise.all([state.__POSTGRES_CONTAINER__?.stop(), state.__REDIS_CONTAINER__?.stop()]);
}
