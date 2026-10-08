import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden } from '../../../common/errors/app-http.exception';
import { isFullyAuthenticated } from '../domain/authenticated-principal';
import { type Permission, roleHasPermission } from '../domain/permissions';
import { REQUIRED_PERMISSIONS } from './auth-decorators';
import type { AuthenticatedRequest } from './session-cookie';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    const allowed =
      principal !== undefined &&
      isFullyAuthenticated(principal) &&
      required.every((permission) => roleHasPermission(principal.role, permission));
    if (!allowed) {
      this.logger.warn({
        event: 'authorization.denied',
        userId: principal?.userId,
        role: principal?.role,
        required,
      });
      throw forbidden();
    }
    return true;
  }
}
