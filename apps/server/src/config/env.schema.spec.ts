import { describe, expect, test } from 'vitest';
import { envSchema } from './env.schema.ts';

describe('env schema', () => {
  test('fails to parse when NODE_ENV is not in the range of [production, development, test]', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'invalid',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe(
      'Invalid option: expected one of "development"|"test"|"production"',
    );
    expect(parsed.error?.issues[0]?.code).toBe('invalid_value');
    expect(parsed.error?.issues[0]?.path[0]).toBe('NODE_ENV');
  });

  test('fails to parse when PORT is not a valid number', () => {
    const parsed = envSchema.safeParse({
      PORT: 'abc',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe('Invalid input: expected number, received NaN');
    expect(parsed.error?.issues[0]?.code).toBe('invalid_type');
    expect(parsed.error?.issues[0]?.path[0]).toBe('PORT');
  });

  test('fails to parse when PORT is negative number', () => {
    const parsed = envSchema.safeParse({
      PORT: '-1',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe('Too small: expected number to be >=1');
    expect(parsed.error?.issues[0]?.code).toBe('too_small');
    expect(parsed.error?.issues[0]?.path[0]).toBe('PORT');
  });

  test('fails to parse when PORT is bigger than 65535', () => {
    const parsed = envSchema.safeParse({
      PORT: '65536',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe('Too big: expected number to be <=65535');
    expect(parsed.error?.issues[0]?.code).toBe('too_big');
    expect(parsed.error?.issues[0]?.path[0]).toBe('PORT');
  });

  test('fails to parse when LOG_LEVEL is not in the range of [debug, info, warn, error]', () => {
    const parsed = envSchema.safeParse({
      LOG_LEVEL: 'invalid',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe(
      'Invalid option: expected one of "debug"|"info"|"warn"|"error"',
    );
    expect(parsed.error?.issues[0]?.code).toBe('invalid_value');
    expect(parsed.error?.issues[0]?.path[0]).toBe('LOG_LEVEL');
  });

  test('fails to parse when OLLAMA_BASE_URL is not a valid url', () => {
    const parsed = envSchema.safeParse({
      OLLAMA_BASE_URL: 'invalid',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe('Invalid URL');
    expect(parsed.error?.issues[0]?.code).toBe('invalid_format');
    expect(parsed.error?.issues[0]?.path[0]).toBe('OLLAMA_BASE_URL');
  });

  test('fails to parse when AGENT_MAX_STEPS is not a valid number', () => {
    const parsed = envSchema.safeParse({
      AGENT_MAX_STEPS: 'invalid',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe('Invalid input: expected number, received NaN');
    expect(parsed.error?.issues[0]?.code).toBe('invalid_type');
    expect(parsed.error?.issues[0]?.path[0]).toBe('AGENT_MAX_STEPS');
  });

  test('fails to parse when AGENT_MAX_STEPS is negative', () => {
    const parsed = envSchema.safeParse({
      AGENT_MAX_STEPS: '-2',
    });

    expect(parsed.error).toBeDefined();
    expect(parsed.error?.issues[0]?.message).toBe('Too small: expected number to be >0');
    expect(parsed.error?.issues[0]?.code).toBe('too_small');
    expect(parsed.error?.issues[0]?.path[0]).toBe('AGENT_MAX_STEPS');
  });

  test('successfully fallbacks to default value when PORT is empty string', () => {
    const parsed = envSchema.safeParse({
      PORT: '',
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBeTruthy();
    expect(parsed.data).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      LLM_MODEL: 'qwen2.5:7b',
      AGENT_MAX_STEPS: 8,
    });
  });

  test('successfully fallbacks to default value when LLM_MODEL is empty string', () => {
    const parsed = envSchema.safeParse({
      LLM_MODEL: '',
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBeTruthy();
    expect(parsed.data).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      LLM_MODEL: 'qwen2.5:7b',
      AGENT_MAX_STEPS: 8,
    });
  });

  test('successfully fallbacks to default value when AGENT_MAX_STEPS is empty string', () => {
    const parsed = envSchema.safeParse({
      AGENT_MAX_STEPS: '',
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBeTruthy();
    expect(parsed.data).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      LLM_MODEL: 'qwen2.5:7b',
      AGENT_MAX_STEPS: 8,
    });
  });

  test('successfully parses with defaults when no env variable is provided', () => {
    const parsed = envSchema.safeParse({});

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBeTruthy();
    expect(parsed.data).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      LLM_MODEL: 'qwen2.5:7b',
      AGENT_MAX_STEPS: 8,
    });
  });

  test('successfully parses with the given env variables', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_LEVEL: 'debug',
      OLLAMA_BASE_URL: 'http://ollama.net',
      LLM_MODEL: 'llama3.2:8b',
      AGENT_MAX_STEPS: 18,
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBeTruthy();
    expect(parsed.data).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_LEVEL: 'debug',
      OLLAMA_BASE_URL: 'http://ollama.net',
      LLM_MODEL: 'llama3.2:8b',
      AGENT_MAX_STEPS: 18,
    });
  });
});
