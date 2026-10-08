import { Module } from '@nestjs/common';
import { TonTreasuryService } from './application/ton-treasury.service';

@Module({ providers: [TonTreasuryService], exports: [TonTreasuryService] })
export class TreasuryModule {}
