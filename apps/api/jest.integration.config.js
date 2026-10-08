/**
 * Database integration tests against a real PostgreSQL started with Testcontainers
 * (requires Docker). Run with `pnpm --filter @robux/api test:integration`.
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest'] },
  globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/support/global-teardown.ts',
  testTimeout: 60_000,
};
