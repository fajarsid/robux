import type { AccountProfileView, AdminOrderView } from '@robux/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminOrder, ORDER_ID } from '@/features/console/orders/testing/admin-order-fixtures';
import ConsoleWorkspaceLayout from './layout';
import ConsoleOrderPage from './orders/[id]/page';
import ConsoleOrdersPage from './orders/page';

const { serverApiGet } = vi.hoisted(() => ({ serverApiGet: vi.fn() }));
vi.mock('@/lib/api/server-api', () => ({
  serverApiGet,
  serverSession: async () => ({ authenticated: false }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error('not-found');
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'app.localhost' }),
  cookies: async () => ({ get: () => undefined }),
}));
// The shell and screens are rendered elements; these tests only check access and data flow.
vi.mock('@/features/console/components/ConsoleShell', () => ({ ConsoleShell: () => null }));

const staff = (role: AccountProfileView['role']): AccountProfileView => ({
  id: 's1',
  email: 'staff@example.test',
  name: null,
  role,
  createdAt: '2026-10-05T00:00:00.000Z',
});

function answer(routes: Record<string, unknown>) {
  serverApiGet.mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    return key ? routes[key] : null;
  });
}

describe('console access and pages', () => {
  beforeEach(() => {
    serverApiGet.mockReset();
  });

  it('sends anyone the API does not accept as staff to the console sign-in', async () => {
    // Anonymous, customer and 2FA-pending sessions all get 401/403 from /admin/me.
    answer({});
    await expect(ConsoleWorkspaceLayout({ children: null })).rejects.toThrow(
      'redirect:/console/login',
    );
    expect(serverApiGet).toHaveBeenCalledWith('/admin/me');
  });

  it('renders the shell for staff', async () => {
    answer({ '/admin/me': staff('OPERATOR') });
    await expect(ConsoleWorkspaceLayout({ children: null })).resolves.toBeTruthy();
  });

  it('reports the order list as unavailable when the endpoint is not served', async () => {
    answer({ '/admin/me': staff('ADMIN') });
    const page = await ConsoleOrdersPage({ searchParams: Promise.resolve({ page: '2' }) });
    expect(page.props.result).toEqual({ kind: 'unavailable' });
    expect(page.props.query.page).toBe(2);
  });

  it('offers cancellation only to roles the API grants it, and 404s unknown orders', async () => {
    const order: AdminOrderView = adminOrder();
    answer({ '/admin/me': staff('OPERATOR'), [`/admin/orders/${ORDER_ID}`]: order });
    const operatorView = await ConsoleOrderPage({ params: Promise.resolve({ id: ORDER_ID }) });
    expect(operatorView.props.mayCancel).toBe(false);

    answer({ '/admin/me': staff('ADMIN'), [`/admin/orders/${ORDER_ID}`]: order });
    const adminView = await ConsoleOrderPage({ params: Promise.resolve({ id: ORDER_ID }) });
    expect(adminView.props.mayCancel).toBe(true);

    await expect(
      ConsoleOrderPage({ params: Promise.resolve({ id: 'not-a-uuid' }) }),
    ).rejects.toThrow('not-found');
  });
});
