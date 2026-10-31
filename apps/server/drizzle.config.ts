import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';
import { envSchema } from './src/config/env.schema.ts';

if (existsSync('.env')) process.loadEnvFile();

const { DATABASE_URL } = envSchema.pick({ DATABASE_URL: true }).parse(process.env);

export default defineConfig({
  out: './src/database/migrations/',
  schema: './src/database/database.schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL,
  },
});
