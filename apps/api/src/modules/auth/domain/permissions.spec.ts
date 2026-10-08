import { Permission, ROLE_PERMISSIONS, roleHasPermission } from './permissions';

describe('role permissions', () => {
  it('limits customers to their own account and orders', () => {
    expect([...ROLE_PERMISSIONS.CUSTOMER].sort()).toEqual(
      [Permission.ACCOUNT_SELF, Permission.CUSTOMER_ORDERS_OWN].sort(),
    );
  });

  it('keeps staff out of customer-only order access', () => {
    for (const role of ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'] as const) {
      expect(roleHasPermission(role, Permission.CUSTOMER_ORDERS_OWN)).toBe(false);
    }
  });

  it('does not let operators change pricing, products, credentials, staff or audit (PRD §69)', () => {
    for (const permission of [
      Permission.PRICING_WRITE,
      Permission.PRODUCTS_WRITE,
      Permission.SOURCE_CREDENTIALS_MANAGE,
      Permission.STAFF_MANAGE,
      Permission.AUDIT_READ,
      Permission.ORDERS_REFUND,
    ]) {
      expect(roleHasPermission('OPERATOR', permission)).toBe(false);
    }
    expect(roleHasPermission('OPERATOR', Permission.ORDERS_READ_ANY)).toBe(true);
    expect(roleHasPermission('OPERATOR', Permission.ORDERS_RETRY)).toBe(true);
  });

  it('applies the owner decisions of 2026-10-05', () => {
    expect(roleHasPermission('OPERATOR', Permission.ORDERS_CANCEL)).toBe(false);
    expect(roleHasPermission('ADMIN', Permission.AUDIT_READ)).toBe(true);
    for (const role of ['CUSTOMER', 'OPERATOR', 'ADMIN'] as const) {
      expect(roleHasPermission(role, Permission.PAYMENTS_REFUND)).toBe(false);
    }
    expect(roleHasPermission('SUPER_ADMIN', Permission.PAYMENTS_REFUND)).toBe(true);
  });

  it('gives admins business configuration but not security administration', () => {
    expect(roleHasPermission('ADMIN', Permission.PRICING_WRITE)).toBe(true);
    expect(roleHasPermission('ADMIN', Permission.STAFF_MANAGE)).toBe(false);
    expect(roleHasPermission('ADMIN', Permission.SOURCE_CREDENTIALS_MANAGE)).toBe(false);
    expect(roleHasPermission('ADMIN', Permission.SETTINGS_SECURITY)).toBe(false);
  });

  it('builds each staff role as a strict superset of the one below', () => {
    const isSubset = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
      [...a].every((p) => b.has(p));
    expect(isSubset(ROLE_PERMISSIONS.OPERATOR, ROLE_PERMISSIONS.ADMIN)).toBe(true);
    expect(isSubset(ROLE_PERMISSIONS.ADMIN, ROLE_PERMISSIONS.SUPER_ADMIN)).toBe(true);
    expect(ROLE_PERMISSIONS.ADMIN.size).toBeGreaterThan(ROLE_PERMISSIONS.OPERATOR.size);
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.size).toBeGreaterThan(ROLE_PERMISSIONS.ADMIN.size);
  });
});
