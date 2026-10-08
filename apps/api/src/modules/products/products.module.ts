import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { CatalogService } from './application/catalog.service';
import { ProductAdminQueriesService } from './application/product-admin-queries.service';
import { ProductManagementService } from './application/product-management.service';
import { AdminProductsController } from './controllers/admin-products.controller';
import { CatalogController } from './controllers/catalog.controller';
import { PRODUCT_REPOSITORY } from './domain/product.repository';
import { PrismaProductRepository } from './infrastructure/prisma-product.repository';

@Module({
  imports: [PricingModule, InventoryModule, AuditModule],
  controllers: [CatalogController, AdminProductsController],
  providers: [
    CatalogService,
    ProductAdminQueriesService,
    ProductManagementService,
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
  ],
  exports: [CatalogService],
})
export class ProductsModule {}
