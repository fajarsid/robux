import { Module } from '@nestjs/common';
import { DependencyHealthService } from './dependency-health.service';

@Module({
  providers: [DependencyHealthService],
  exports: [DependencyHealthService],
})
export class DependencyHealthModule {}
