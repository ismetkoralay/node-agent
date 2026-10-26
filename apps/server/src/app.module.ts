import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module.ts';
import { HealthModule } from './health/health.module.ts';

@Module({
  imports: [HealthModule, EnvModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
