import type { AccountProfileView } from '@robux/shared';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { serverApiGet } from '@/lib/api/server-api';
import { CONSOLE_ROUTES } from '../routes';

/**
 * Null when the visitor is not fully authenticated staff (no session, customer, or a 2FA code
 * still pending). Cached per request: layout and page share one API call.
 */
export const fetchStaffProfile = cache((): Promise<AccountProfileView | null> =>
  serverApiGet<AccountProfileView>('/admin/me'),
);

/** The API decides; this only sends a refused visitor to the console sign-in. */
export async function requireStaff(): Promise<AccountProfileView> {
  const staff = await fetchStaffProfile();
  if (!staff) {
    redirect(CONSOLE_ROUTES.login);
  }
  return staff;
}
