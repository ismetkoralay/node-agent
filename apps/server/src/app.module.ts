import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module.ts';
import { HealthModule } from './health/health.module.ts';
import { LoggerModule } from './logger/logger.module.ts';

@Module({
  imports: [EnvModule, LoggerModule, HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
