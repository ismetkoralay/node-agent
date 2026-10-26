import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { VERSION } from '@node-agent/core';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Controller('health')
export class HealthController {
  constructor(
    @InjectPinoLogger(HealthController.name) private readonly logger: PinoLogger,
    private readonly health: HealthCheckService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([]);
    this.logger.info('health check called');
    return { ...result, version: VERSION };
  }
}
