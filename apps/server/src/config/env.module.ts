import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';
import { envSchema } from './env.schema.ts';
import { EnvService } from './env.service.ts';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (config) => {
        const parsed = envSchema.safeParse(config);
        if (!parsed.success) {
          throw new Error(`Environment validation failed: ${z.prettifyError(parsed.error)}`, {
            cause: parsed.error,
          });
        }
        return parsed.data;
      },
    }),
  ],
  providers: [EnvService],
  exports: [EnvService],
})
export class EnvModule {}
