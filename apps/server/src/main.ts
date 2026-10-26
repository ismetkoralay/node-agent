import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { EnvService } from './config/env.service.ts';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const envService = app.get(EnvService);
  const port = envService.get('PORT');
  const nodeEnv = envService.get('NODE_ENV');
  await app.listen(port);
  logger.log(`🚀 Application is running in ${nodeEnv} mode on: http://localhost:${port}`);
}
await bootstrap();
