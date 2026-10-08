import type { RateLimitRule } from '../../../common/rate-limit/rate-limit.decorator';

/** Authentication limits (SECURITY.md §7). Windows are fixed; values allow normal retries. */
export const AUTH_RATE_LIMITS = {
  customerLoginPerAccount: {
    name: 'login:customer:ip-email',
    scope: 'ip-email',
    limit: 10,
    windowSeconds: 900,
  },
  customerLoginPerIp: { name: 'login:customer:ip', scope: 'ip', limit: 30, windowSeconds: 900 },
  staffLoginPerAccount: {
    name: 'login:staff:ip-email',
    scope: 'ip-email',
    limit: 5,
    windowSeconds: 900,
  },
  staffLoginPerIp: { name: 'login:staff:ip', scope: 'ip', limit: 20, windowSeconds: 900 },
  registerPerIp: { name: 'register:ip', scope: 'ip', limit: 5, windowSeconds: 3600 },
  logoutPerIp: { name: 'logout:ip', scope: 'ip', limit: 30, windowSeconds: 60 },
  /** Per user, so opening a new session does not reset the guess budget. */
  twoFactorPerUser: { name: '2fa:principal', scope: 'principal', limit: 5, windowSeconds: 300 },
  twoFactorSetupPerUser: {
    name: '2fa-setup:principal',
    scope: 'principal',
    limit: 10,
    windowSeconds: 900,
  },
  twoFactorPerIp: { name: '2fa:ip', scope: 'ip', limit: 20, windowSeconds: 900 },
  passwordChangePerUser: {
    name: 'password-change:principal',
    scope: 'principal',
    limit: 5,
    windowSeconds: 900,
  },
} as const satisfies Record<string, RateLimitRule>;
