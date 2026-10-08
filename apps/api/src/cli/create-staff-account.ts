import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config/app-config';
import { PrismaClient } from '../generated/prisma/client';
import type { UserRole } from '../generated/prisma/enums';
import { DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN } from '../modules/auth/domain/development-accounts';
import { STAFF_ROLES } from '../modules/auth/domain/permissions';
import { Argon2PasswordHasher } from '../modules/auth/infrastructure/argon2-password.hasher';

/**
 * Creates a staff account with a random one-time password, printed once to the terminal (never
 * logged or stored in plaintext). The person must enroll TOTP at first login and should change
 * the password afterwards. This is how the first SUPER_ADMIN is created in production:
 *
 *   docker compose ... run --rm api node dist/cli/create-staff-account.js --email a@b.c --role SUPER_ADMIN
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, role: { type: 'string' }, name: { type: 'string' } },
  });
  const email = values.email?.trim().toLowerCase();
  const role = values.role as UserRole | undefined;
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || !role || !STAFF_ROLES.includes(role)) {
    throw new Error(`Usage: --email <address> --role <${STAFF_ROLES.join('|')}> [--name <name>]`);
  }
  if (email.endsWith(`@${DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN}`)) {
    throw new Error('The development account domain is reserved for the seed');
  }

  const password = randomBytes(18).toString('base64url');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: loadConfig('api').databaseUrl }),
  });
  try {
    const user = await prisma.user.create({
      data: {
        email,
        role,
        name: values.name,
        passwordHash: await new Argon2PasswordHasher().hash(password),
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'STAFF_ACCOUNT_CHANGED',
        result: 'SUCCESS',
        actorType: 'SYSTEM',
        resourceType: 'user',
        resourceId: user.id,
        after: { email, role },
        reason: 'created with create-staff-account CLI',
      },
    });
    process.stdout.write(
      `Created ${role} ${email}\nOne-time password (shown once): ${password}\n` +
        'Sign in at /admin/login, enroll the authenticator app, then change this password.\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
