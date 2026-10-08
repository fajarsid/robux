import type { TwoFactorState } from '@robux/shared';
import type { UserRole } from '../../../generated/prisma/enums';

/** The authenticated caller, resolved from the session cookie for each request. */
export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
  sessionId: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  twoFactor: TwoFactorState;
}

const FULLY_AUTHENTICATED_STATES: readonly TwoFactorState[] = [
  'NOT_REQUIRED',
  'NOT_ENROLLED',
  'VERIFIED',
];

/**
 * 2FA is optional for staff (owner decision 2026-10-05), but once enabled it is enforced: a staff
 * session with TOTP enabled grants no permission until the code is verified (PENDING).
 */
export function isFullyAuthenticated(principal: AuthenticatedPrincipal): boolean {
  return FULLY_AUTHENTICATED_STATES.includes(principal.twoFactor);
}
