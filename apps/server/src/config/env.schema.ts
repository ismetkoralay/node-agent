import { z } from 'zod';

const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: emptyAsUndefined(z.coerce.number().int().min(1).max(65535).default(3000)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  LLM_MODEL: emptyAsUndefined(z.string().min(1).default('qwen2.5:7b')),
  AGENT_MAX_STEPS: emptyAsUndefined(z.coerce.number().int().positive().default(8)),
});

export type Env = z.infer<typeof envSchema>;
