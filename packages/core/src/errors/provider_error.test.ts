import { expect, test } from 'vitest';
import { AgentError, ProviderError } from './index.ts';

test('keeps the original error as cause', () => {
  const original = new Error('connection refused');
  const err = new ProviderError('ollama unreachable', {
    provider: 'ollama',
    retryable: true,
    cause: original,
  });

  expect(err.cause).toBe(original);
});

test('is an AgentError and an Error', () => {
  const err = new ProviderError('x', { provider: 'ollama', retryable: false });

  expect(err).toBeInstanceOf(ProviderError);
  expect(err).toBeInstanceOf(AgentError);
  expect(err).toBeInstanceOf(Error);
});

test('exposes provider, retryable, code, name and message', () => {
  const err = new ProviderError('bad request', { provider: 'ollama', retryable: false });

  expect(err).toMatchObject({
    message: 'bad request',
    name: 'ProviderError',
    code: 'provider_error',
    provider: 'ollama',
    retryable: false,
  });
});

test('has no cause when none is given', () => {
  const err = new ProviderError('x', { provider: 'ollama', retryable: false });

  expect('cause' in err).toBe(false);
});
