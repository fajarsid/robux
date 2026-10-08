import type { UserRole } from '../../../generated/prisma/enums';

/**
 * Development-only accounts created by the seed. `.test` is reserved (RFC 2606) and can never be
 * a real mailbox. Production refuses to start if any of these exist or if any staff account
 * still uses this password (ProductionAccountSafetyCheck).
 */
export const DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN = 'dev.robux.test';
export const DEVELOPMENT_ACCOUNT_PASSWORD = 'dev-only-password-change-me';

export const DEVELOPMENT_ACCOUNTS: readonly {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}[] = [
  {
    id: '01926f00-0000-7000-8000-0000000c0001',
    email: `superadmin@${DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN}`,
    name: 'Dev Super Admin',
    role: 'SUPER_ADMIN',
  },
  {
    id: '01926f00-0000-7000-8000-0000000c0002',
    email: `admin@${DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN}`,
    name: 'Dev Admin',
    role: 'ADMIN',
  },
  {
    id: '01926f00-0000-7000-8000-0000000c0003',
    email: `operator@${DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN}`,
    name: 'Dev Operator',
    role: 'OPERATOR',
  },
  {
    id: '01926f00-0000-7000-8000-0000000c0004',
    email: `customer@${DEVELOPMENT_ACCOUNT_EMAIL_DOMAIN}`,
    name: 'Dev Customer',
    role: 'CUSTOMER',
  },
];
