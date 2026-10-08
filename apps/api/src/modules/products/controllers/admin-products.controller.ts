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
  type AdminProductDetailView,
  type AdminProductView,
  type CreatePriceVersionRequest,
  type CreateProductRequest,
  createPriceVersionRequestSchema,
  createProductRequestSchema,
  type UpdateProductRequest,
  updateProductRequestSchema,
} from '@robux/shared';
import type { Request } from 'express';
import { requestContextOf } from '../../../common/http/request-context';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { Permission, roleHasPermission } from '../../auth/domain/permissions';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/auth-decorators';
import { ProductAdminQueriesService } from '../application/product-admin-queries.service';
import { ProductManagementService } from '../application/product-management.service';

const canSeeCosts = (principal: AuthenticatedPrincipal) =>
  roleHasPermission(principal.role, Permission.PRICING_WRITE);

@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly queries: ProductAdminQueriesService,
    private readonly management: ProductManagementService,
  ) {}

  @Get()
  @RequirePermissions(Permission.PRODUCTS_READ)
  list(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<AdminProductView[]> {
    return this.queries.list(canSeeCosts(principal));
  }

  @Get(':id')
  @RequirePermissions(Permission.PRODUCTS_READ)
  detail(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminProductDetailView> {
    return this.queries.detail(id, canSeeCosts(principal));
  }

  /** Creating a product sets its first price, so it needs both permissions. */
  @Post()
  @RequirePermissions(Permission.PRODUCTS_WRITE, Permission.PRICING_WRITE)
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createProductRequestSchema)) body: CreateProductRequest,
    @Req() req: Request,
  ): Promise<AdminProductDetailView> {
    const product = await this.management.create(principal, body, requestContextOf(req));
    return this.queries.detail(product.id, true);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRODUCTS_WRITE)
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateProductRequestSchema)) body: UpdateProductRequest,
    @Req() req: Request,
  ): Promise<AdminProductDetailView> {
    await this.management.update(principal, id, body, requestContextOf(req));
    return this.queries.detail(id, canSeeCosts(principal));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRODUCTS_WRITE)
  async activate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<AdminProductDetailView> {
    await this.management.setActive(principal, id, true, requestContextOf(req));
    return this.queries.detail(id, canSeeCosts(principal));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRODUCTS_WRITE)
  async deactivate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<AdminProductDetailView> {
    await this.management.setActive(principal, id, false, requestContextOf(req));
    return this.queries.detail(id, canSeeCosts(principal));
  }

  @Post(':id/prices')
  @RequirePermissions(Permission.PRICING_WRITE)
  async changePrice(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createPriceVersionRequestSchema)) body: CreatePriceVersionRequest,
    @Req() req: Request,
  ): Promise<AdminProductDetailView> {
    await this.management.changePrice(principal, id, body, requestContextOf(req));
    return this.queries.detail(id, true);
  }
}
