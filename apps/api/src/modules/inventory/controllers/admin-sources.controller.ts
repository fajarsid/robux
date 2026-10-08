import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  type AdjustSourceBalanceRequest,
  type AdminSourceView,
  adjustSourceBalanceRequestSchema,
  type CreateSourceRequest,
  createSourceRequestSchema,
  type UpdateSourceRequest,
  updateSourceRequestSchema,
} from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission, roleHasPermission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import {
  SourceManagementService,
  toAdminSourceView,
} from '../application/source-management.service';

const canSeeCost = (principal: AuthenticatedPrincipal) =>
  roleHasPermission(principal.role, Permission.INVENTORY_MANAGE);

@Controller('admin/inventory/sources')
export class AdminSourcesController {
  constructor(private readonly management: SourceManagementService) {}

  @Get()
  @RequirePermissions(Permission.INVENTORY_READ)
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<AdminSourceView[]> {
    return (await this.management.list()).map((s) => toAdminSourceView(s, canSeeCost(principal)));
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createSourceRequestSchema)) body: CreateSourceRequest,
    @Req() req: Request,
  ): Promise<AdminSourceView> {
    return toAdminSourceView(
      await this.management.create(principal, body, requestContextOf(req)),
      true,
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateSourceRequestSchema)) body: UpdateSourceRequest,
    @Req() req: Request,
  ): Promise<AdminSourceView> {
    return toAdminSourceView(
      await this.management.update(principal, id, body, requestContextOf(req)),
      true,
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  async activate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<AdminSourceView> {
    return toAdminSourceView(
      await this.management.setActive(principal, id, true, requestContextOf(req)),
      true,
    );
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  async deactivate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<AdminSourceView> {
    return toAdminSourceView(
      await this.management.setActive(principal, id, false, requestContextOf(req)),
      true,
    );
  }

  @Post(':id/adjustments')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  async adjust(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adjustSourceBalanceRequestSchema)) body: AdjustSourceBalanceRequest,
    @Req() req: Request,
  ): Promise<AdminSourceView> {
    return toAdminSourceView(
      await this.management.adjust(principal, id, body, requestContextOf(req)),
      true,
    );
  }
}
