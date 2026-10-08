import { defineConfig } from 'prisma/config';

// DATABASE_URL is assembled at container start from non-secret parts plus the password
// secret file (infra/docker/with-database-url.sh) and is never committed. It is only needed by
// commands that talk to the database (`migrate deploy`); `prisma generate` runs without it.
export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations', seed: 'node dist/seed/run-seed.js' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
