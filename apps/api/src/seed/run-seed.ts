import { PrismaPg } from '@prisma/adapter-pg';
import pino from 'pino';
import { loadConfig } from '../config/app-config';
import { PrismaClient } from '../generated/prisma/client';
import { seedDevelopmentData } from './seed-development-data';

const logger = pino({
  base: { service: 'seed' },
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label: string) => ({ level: label }) },
});

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed development data with NODE_ENV=production');
  }
  const connectionString = process.env.DATABASE_URL ?? loadConfig('api').databaseUrl;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seedDevelopmentData(prisma);
    logger.info({ event: 'seed.completed' });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  logger.error({ event: 'seed.failed', err });
  process.exit(1);
});
