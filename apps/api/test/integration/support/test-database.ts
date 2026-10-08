import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../../../src/common/database/prisma.service';
import { PrismaClient } from '../../../src/generated/prisma/client';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set; run through jest.integration.config.js');
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
}

/** Repositories depend on PrismaService; in tests a plain client with the same API stands in. */
export function asPrismaService(prisma: PrismaClient): PrismaService {
  return prisma as unknown as PrismaService;
}

interface DriverAdapterCause {
  originalCode?: string;
  originalMessage?: string;
  constraint?: { index?: string; name?: string; fields?: string[] };
}

/** PostgreSQL SQLSTATE, constraint name and message, as Prisma exposes them through the pg adapter. */
function describeDatabaseError(error: unknown): {
  code?: string;
  constraint?: string;
  text: string;
} {
  const prismaError = error as {
    message?: string;
    meta?: { driverAdapterError?: { cause?: DriverAdapterCause } };
  };
  const cause = prismaError.meta?.driverAdapterError?.cause;
  const constraint = cause?.constraint?.index ?? cause?.constraint?.name;
  return {
    code: cause?.originalCode,
    constraint,
    text: [cause?.originalMessage, prismaError.message, String(error)].filter(Boolean).join(' | '),
  };
}

export async function expectDatabaseError(
  operation: Promise<unknown>,
  expected: { code?: string; constraint?: string; message?: RegExp },
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  if (!caught) {
    throw new Error('Expected the database to reject the operation, but it succeeded');
  }
  const actual = describeDatabaseError(caught);
  const constraintMatches =
    !expected.constraint ||
    actual.constraint === expected.constraint ||
    actual.text.includes(`"${expected.constraint}"`);
  if (
    (expected.code && actual.code !== expected.code) ||
    !constraintMatches ||
    (expected.message && !expected.message.test(actual.text))
  ) {
    throw new Error(
      `Database error mismatch. Expected ${JSON.stringify({ ...expected, message: expected.message?.source })}, ` +
        `got ${JSON.stringify({ code: actual.code, constraint: actual.constraint, text: actual.text.slice(0, 400) })}`,
    );
  }
}
