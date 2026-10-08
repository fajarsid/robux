import type {
  ChangePasswordRequest,
  LoginRequest,
  RecoveryCodesView,
  RegisterRequest,
  SessionView,
  TwoFactorEnrollmentView,
} from '@robux/shared';
import { apiSend, fetchSession } from '@/lib/api/browser-api';

/** Every auth call the browser makes. The API is the authority; this only transports requests. */
export const authService = {
  session: (): Promise<SessionView> => fetchSession(),

  async loginCustomer(request: LoginRequest): Promise<void> {
    await fetchSession();
    await apiSend('POST', '/auth/login', request);
  },

  async loginStaff(request: LoginRequest): Promise<void> {
    await fetchSession();
    await apiSend('POST', '/admin/auth/login', request);
  },

  async register(request: RegisterRequest): Promise<void> {
    await fetchSession();
    await apiSend('POST', '/auth/register', request);
  },

  logout: () => apiSend<void>('POST', '/auth/logout'),

  changePassword: (request: ChangePasswordRequest) =>
    apiSend<void>('POST', '/me/password', request),

  beginTwoFactorEnrollment: () => apiSend<TwoFactorEnrollmentView>('POST', '/admin/auth/2fa/setup'),

  activateTwoFactor: (code: string) =>
    apiSend<RecoveryCodesView>('POST', '/admin/auth/2fa/activate', { code }),

  verifyTwoFactor: (code: string) => apiSend<void>('POST', '/admin/auth/2fa/verify', { code }),

  useRecoveryCode: (recoveryCode: string) =>
    apiSend<void>('POST', '/admin/auth/2fa/recovery', { recoveryCode }),
};
