import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.ts';
import { EnvService } from './config/env.service.ts';
import { setupSwagger } from './swagger.ts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const envService = app.get(EnvService);
  const port = envService.get('PORT');
  const nodeEnv = envService.get('NODE_ENV');

  setupSwagger(app);

  await app.listen(port);
  logger.log(`🚀 Application is running in ${nodeEnv} mode on: http://localhost:${port}`);
}
await bootstrap();
