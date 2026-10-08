import { Module } from '@nestjs/common';
import { SOURCE_CANDIDATE_READER } from './domain/source-candidate.reader';
import { SOURCE_HEALTH_REPOSITORY } from './domain/source-health.repository';
import { STOCK_AVAILABILITY_READER } from './domain/stock-availability.reader';
import { PrismaSourceCandidateReader } from './infrastructure/prisma-source-candidate.reader';
import { PrismaSourceHealthRepository } from './infrastructure/prisma-source-health.repository';
import { PrismaStockAvailabilityReader } from './infrastructure/prisma-stock-availability.reader';

@Module({
  providers: [
    { provide: STOCK_AVAILABILITY_READER, useClass: PrismaStockAvailabilityReader },
    { provide: SOURCE_CANDIDATE_READER, useClass: PrismaSourceCandidateReader },
    { provide: SOURCE_HEALTH_REPOSITORY, useClass: PrismaSourceHealthRepository },
  ],
  exports: [STOCK_AVAILABILITY_READER, SOURCE_CANDIDATE_READER, SOURCE_HEALTH_REPOSITORY],
})
export class InventoryModule {}
