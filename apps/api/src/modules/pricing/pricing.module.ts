import { Module } from '@nestjs/common';
import { PriceVersionService } from './application/price-version.service';
import { PRICE_VERSION_REPOSITORY } from './domain/price-version.repository';
import { PrismaPriceVersionRepository } from './infrastructure/prisma-price-version.repository';

@Module({
  providers: [
    PriceVersionService,
    { provide: PRICE_VERSION_REPOSITORY, useClass: PrismaPriceVersionRepository },
  ],
  exports: [PriceVersionService],
})
export class PricingModule {}
