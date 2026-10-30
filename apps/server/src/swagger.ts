import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by `main.ts` and the e2e tests, so the tests see the same `/docs` and `/docs-json`. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('node-agent')
    .setDescription('HTTP API of the node-agent LLM agent runtime: conversations and messages.')
    .setVersion('0.0.1')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
