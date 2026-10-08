import type { SessionView } from '@robux/shared';
import { headers } from 'next/headers';
import { ApiError } from './api-error';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://api:4000';

/**
 * Server components call the API over the internal network, forwarding the visitor's session
 * cookie and IP (so per-client rate limits apply to the visitor, not to the frontend container).
 * Returns null on 401/403/404 so pages can redirect or show "not found".
 */
export async function serverApiGet<T>(path: string): Promise<T | null> {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  const cookie = incoming.get('cookie');
  const clientIp = incoming.get('x-real-ip');
  if (cookie) {
    forwarded.cookie = cookie;
  }
  if (clientIp) {
    forwarded['x-forwarded-for'] = clientIp;
  }
  const response = await fetch(`${API_INTERNAL_URL}/api/v1${path}`, {
    headers: forwarded,
    cache: 'no-store',
  });
  if ([401, 403, 404].includes(response.status)) {
    return null;
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'INTERNAL_ERROR', 'API request failed');
  }
  return (await response.json()) as T;
}

export async function serverSession(): Promise<SessionView> {
  return (await serverApiGet<SessionView>('/auth/session')) ?? { authenticated: false };
}
