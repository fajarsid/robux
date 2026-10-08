import type { AdminOrderView, UserRoleName } from '@robux/shared';

/**
 * Presentation hints only; the API enforces both rules on every request. They mirror the
 * backend's `orders.cancel` grant (ADMIN, SUPER_ADMIN; OPERATOR denied by owner decision) and
 * its cancellable statuses (CREATED, PAYMENT_PENDING, i.e. the AWAITING_PAYMENT stage). Replace
 * with API-provided flags once `/admin/me` exposes permissions and `AdminOrderView` exposes
 * `cancellable`.
 */
const CANCEL_ROLES: readonly UserRoleName[] = ['ADMIN', 'SUPER_ADMIN'];

export function roleMayCancelOrders(role: UserRoleName): boolean {
  return CANCEL_ROLES.includes(role);
}

export function isAwaitingPayment(order: Pick<AdminOrderView, 'stage'>): boolean {
  return order.stage === 'AWAITING_PAYMENT';
}
