import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.ts';

@Module({
  imports: [HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
