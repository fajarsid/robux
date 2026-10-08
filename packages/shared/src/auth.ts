import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((value) => value.toLowerCase());

const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

// Strict objects reject unknown keys, so credentials for other systems (e.g. a Roblox
// password) can never be sent along and stored by accident.
export const registerRequestSchema = z.strictObject({
  email,
  password: newPassword,
  name: z.string().trim().min(1).max(80).optional(),
});

export const loginRequestSchema = z.strictObject({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword,
});

export const totpCodeRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
});

export const recoveryCodeRequestSchema = z.strictObject({
  recoveryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/),
});

export const STAFF_ROLE_NAMES = ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'] as const;

export const changeStaffRoleRequestSchema = z.strictObject({
  role: z.enum(STAFF_ROLE_NAMES),
});

export type ChangeStaffRoleRequest = z.infer<typeof changeStaffRoleRequestSchema>;

export interface AccountProfileView {
  id: string;
  email: string;
  name: string | null;
  role: UserRoleName;
  createdAt: string;
}

export interface StaffMemberView {
  id: string;
  email: string;
  name: string | null;
  role: UserRoleName;
  status: 'ACTIVE' | 'SUSPENDED';
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
}

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export type UserRoleName = 'CUSTOMER' | 'OPERATOR' | 'ADMIN' | 'SUPER_ADMIN';

/**
 * NOT_REQUIRED: customer. NOT_ENROLLED: staff who has not enabled TOTP (2FA is optional, the
 * session is fully authenticated). PENDING: staff with TOTP enabled, code not yet verified in
 * this session. VERIFIED: staff with TOTP enabled and verified.
 */
export type TwoFactorState = 'NOT_REQUIRED' | 'NOT_ENROLLED' | 'PENDING' | 'VERIFIED';

export interface SessionUserView {
  id: string;
  email: string;
  name: string | null;
  role: UserRoleName;
}

export type SessionView =
  | { authenticated: false }
  | {
      authenticated: true;
      user: SessionUserView;
      twoFactor: TwoFactorState;
      csrfToken: string;
      expiresAt: string;
    };

export interface TwoFactorEnrollmentView {
  /** Base32 secret for manual entry in an authenticator app. */
  secret: string;
  otpauthUri: string;
}

export interface RecoveryCodesView {
  /** Shown exactly once, right after enrollment. */
  recoveryCodes: string[];
}
