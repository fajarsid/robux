import type { CookieOptions, Request, Response } from 'express';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';

/** `__Host-` forces Secure, Path=/ and no Domain: the cookie cannot be set by a sibling subdomain. */
const SECURE_COOKIE_NAME = '__Host-sid';
/** Plain-HTTP automated tests only; production refuses SESSION_COOKIE_SECURE=false. */
const INSECURE_COOKIE_NAME = 'sid';

export interface AuthenticatedRequest extends Request {
  principal?: AuthenticatedPrincipal;
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_COOKIE_NAME : INSECURE_COOKIE_NAME;
}

function cookieOptions(secure: boolean, expires?: Date): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', expires };
}

export function readSessionToken(req: Request, secure: boolean): string | undefined {
  const value: unknown = req.cookies?.[sessionCookieName(secure)];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function setSessionCookie(
  res: Response,
  secure: boolean,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(sessionCookieName(secure), token, cookieOptions(secure, expiresAt));
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(sessionCookieName(secure), cookieOptions(secure));
}
