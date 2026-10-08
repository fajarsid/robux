import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { authenticationRequired } from '../../../common/errors/app-http.exception';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import type { Permission } from '../domain/permissions';
import type { AuthenticatedRequest } from './session-cookie';

export const IS_PUBLIC = Symbol('IS_PUBLIC');
export const ALLOW_PENDING_TWO_FACTOR = Symbol('ALLOW_PENDING_TWO_FACTOR');
export const REQUIRED_PERMISSIONS = Symbol('REQUIRED_PERMISSIONS');
export const SKIP_CSRF = Symbol('SKIP_CSRF');

/** Routes are authenticated by default; this opts a route out (the session is still resolved if present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Lets a staff session that has not completed 2FA reach the route (2FA endpoints themselves). */
export const AllowPendingTwoFactor = () => SetMetadata(ALLOW_PENDING_TWO_FACTOR, true);

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Only for endpoints authenticated another way (signed webhooks). Never for cookie-authenticated routes. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) {
      throw authenticationRequired();
    }
    return principal;
  },
);
