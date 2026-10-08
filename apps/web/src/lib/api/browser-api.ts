import type { ApiErrorBody, SessionView } from '@robux/shared';
import { ApiError } from './api-error';

/**
 * Browser calls go to the same origin (`/api/v1`, routed by Nginx, ADR-008), so the HttpOnly
 * session cookie is sent automatically. State-changing calls carry the session-bound CSRF token.
 */
let csrfToken: string | undefined;

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = body as Partial<ApiErrorBody> | undefined;
    throw new ApiError(response.status, error?.code ?? 'INTERNAL_ERROR', error?.message ?? '');
  }
  return body as T;
}

export async function fetchSession(): Promise<SessionView> {
  const session = await apiGet<SessionView>('/auth/session');
  csrfToken = session.authenticated ? session.csrfToken : undefined;
  return session;
}

export async function apiGet<T>(path: string): Promise<T> {
  try {
    return await parse<T>(
      await fetch(`/api/v1${path}`, { credentials: 'same-origin', cache: 'no-store' }),
    );
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(0, 'NETWORK_ERROR', '');
  }
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const send = () =>
    fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    let response = await send();
    if (response.status === 403) {
      // The session may have rotated since the token was fetched; refresh it once and retry.
      const cloned = response.clone();
      const error = (await cloned.json().catch(() => undefined)) as
        Partial<ApiErrorBody> | undefined;
      if (error?.code === 'CSRF_REJECTED') {
        await fetchSession();
        response = await send();
      }
    }
    const result = await parse<T>(response);
    await fetchSession();
    return result;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(0, 'NETWORK_ERROR', '');
  }
}
