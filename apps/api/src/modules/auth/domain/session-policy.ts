const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SessionKind = 'CUSTOMER' | 'STAFF' | 'STAFF_PENDING_TWO_FACTOR';

interface SessionLifetime {
  idleMs: number;
  absoluteMs: number;
}

/** ADR-008. A staff session waiting for 2FA is short-lived and grants no staff permissions. */
export const SESSION_LIFETIMES: Readonly<Record<SessionKind, SessionLifetime>> = {
  CUSTOMER: { idleMs: 7 * DAY, absoluteMs: 30 * DAY },
  STAFF: { idleMs: 30 * MINUTE, absoluteMs: 12 * HOUR },
  STAFF_PENDING_TWO_FACTOR: { idleMs: 5 * MINUTE, absoluteMs: 5 * MINUTE },
};

/** Idle expiry is only extended when this much time has passed, to avoid a write per request. */
export const SESSION_TOUCH_INTERVAL_MS = MINUTE;

export function sessionExpiry(kind: SessionKind, now: Date) {
  const lifetime = SESSION_LIFETIMES[kind];
  return {
    idleExpiresAt: new Date(now.getTime() + lifetime.idleMs),
    expiresAt: new Date(now.getTime() + lifetime.absoluteMs),
  };
}

/** Sliding idle window, never beyond the absolute expiry. */
export function extendedIdleExpiry(kind: SessionKind, now: Date, absoluteExpiresAt: Date): Date {
  const candidate = now.getTime() + SESSION_LIFETIMES[kind].idleMs;
  return new Date(Math.min(candidate, absoluteExpiresAt.getTime()));
}
