import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AgentModule } from './agent/agent.module.ts';
import { ChatModule } from './chat/chat.module.ts';
import { AllExceptionsFilter } from './common/all-exceptions.filter.ts';
import { EnvModule } from './config/env.module.ts';
import { HealthModule } from './health/health.module.ts';
import { LoggerModule } from './logger/logger.module.ts';

@Module({
  imports: [EnvModule, LoggerModule, HealthModule, AgentModule, ChatModule],
  controllers: [],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
