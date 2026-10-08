import type { UserRole } from '../../../generated/prisma/enums';

/**
 * Explicit permissions checked by the backend. Roles map to permission sets below; nothing is
 * granted implicitly by role name. Unresolved PRD questions are listed in SECURITY.md §4.
 */
export const Permission = {
  ACCOUNT_SELF: 'account.self',
  CUSTOMER_ORDERS_OWN: 'customer.orders.own',

  STAFF_CONSOLE: 'staff.console',
  ORDERS_READ_ANY: 'orders.read.any',
  ORDERS_RETRY: 'orders.retry',
  ORDERS_CANCEL: 'orders.cancel',
  /** Refund of an eligible, not yet fulfilled order (PRD §72). */
  ORDERS_REFUND: 'orders.refund',
  /** Refund of a FULFILLED order: the PRD §72 exception. Owner decision 2026-10-05: SUPER_ADMIN only. */
  PAYMENTS_REFUND: 'payments.refund',
  FULFILLMENT_READ: 'fulfillment.read',
  CUSTOMERS_READ: 'customers.read',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  PRICING_WRITE: 'pricing.write',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_MANAGE: 'inventory.manage',
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  REPORTS_READ: 'reports.read',
  SETTINGS_OPERATIONAL: 'settings.operational',

  SETTINGS_SECURITY: 'settings.security',
  SOURCE_CREDENTIALS_MANAGE: 'sources.credentials.manage',
  STAFF_MANAGE: 'staff.manage',
  AUDIT_READ: 'audit.read',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const CUSTOMER: Permission[] = [Permission.ACCOUNT_SELF, Permission.CUSTOMER_ORDERS_OWN];

const OPERATOR: Permission[] = [
  Permission.ACCOUNT_SELF,
  Permission.STAFF_CONSOLE,
  Permission.ORDERS_READ_ANY,
  Permission.ORDERS_RETRY,
  Permission.FULFILLMENT_READ,
  Permission.CUSTOMERS_READ,
  Permission.PRODUCTS_READ,
  Permission.INVENTORY_READ,
];

const ADMIN: Permission[] = [
  ...OPERATOR,
  Permission.ORDERS_CANCEL,
  Permission.ORDERS_REFUND,
  Permission.PRODUCTS_WRITE,
  Permission.PRICING_WRITE,
  Permission.INVENTORY_MANAGE,
  Permission.NOTIFICATIONS_MANAGE,
  Permission.REPORTS_READ,
  Permission.SETTINGS_OPERATIONAL,
  // Owner decision 2026-10-05: ADMIN may read (never modify) the audit log.
  Permission.AUDIT_READ,
];

const SUPER_ADMIN: Permission[] = [
  ...ADMIN,
  Permission.SETTINGS_SECURITY,
  Permission.SOURCE_CREDENTIALS_MANAGE,
  Permission.STAFF_MANAGE,
  Permission.PAYMENTS_REFUND,
];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  CUSTOMER: new Set(CUSTOMER),
  OPERATOR: new Set(OPERATOR),
  ADMIN: new Set(ADMIN),
  SUPER_ADMIN: new Set(SUPER_ADMIN),
};

export const STAFF_ROLES: readonly UserRole[] = ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'];

export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
