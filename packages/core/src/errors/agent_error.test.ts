import { expect, test } from 'vitest';
import { AgentError } from './index.ts';

test('carries message and code', () => {
  const err = new AgentError('boom', 'some_code');

  expect(err).toBeInstanceOf(Error);
  expect(err).toMatchObject({ message: 'boom', code: 'some_code', name: 'AgentError' });
});

test('passes cause through to Error', () => {
  const original = new Error('root');

  expect(new AgentError('boom', 'some_code', { cause: original }).cause).toBe(original);
});
