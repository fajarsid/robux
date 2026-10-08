import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import {
  createDigitalAccountInventoryRequestSchema,
  type CreateDigitalAccountInventoryRequest,
} from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { DigitalAccountInventoryService } from '../application/digital-account-inventory.service';

@Controller('admin/inventory/accounts')
export class AdminDigitalAccountsController {
  constructor(private readonly inventory: DigitalAccountInventoryService) {}

  @Get()
  @RequirePermissions(Permission.INVENTORY_READ)
  list() {
    return this.inventory.list();
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createDigitalAccountInventoryRequestSchema))
    body: CreateDigitalAccountInventoryRequest,
    @Req() req: Request,
  ) {
    return this.inventory.create(principal, body, requestContextOf(req));
  }

  @Post(':id/block')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  async block(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    await this.inventory.block(principal, id, requestContextOf(req));
    return { status: 'BLOCKED' as const };
  }
}
