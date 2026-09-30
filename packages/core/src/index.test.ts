import { expect, test } from 'vitest';
import { AgentError, ProviderError, VERSION } from './index.ts';

test('exports VERSION as a string', () => {
  expect(typeof VERSION).toBe('string');
});

test('exports the error classes from the package root', () => {
  expect(new ProviderError('x', { provider: 'p', retryable: false })).toBeInstanceOf(AgentError);
});
