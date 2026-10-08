import { Module } from '@nestjs/common';
import { DependencyHealthModule } from '../../common/health/dependency-health.module';
import { HealthController } from './controllers/health.controller';

@Module({
  imports: [DependencyHealthModule],
  controllers: [HealthController],
})
export class HealthModule {}
