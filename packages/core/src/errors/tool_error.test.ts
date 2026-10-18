import { expect, test } from 'vitest';
import { AgentError } from './agent_error.ts';
import { ToolError } from './tool_error.ts';

test('is an AgentError and an Error', () => {
  const err = new ToolError('x', 'y');

  expect(err).toBeInstanceOf(ToolError);
  expect(err).toBeInstanceOf(AgentError);
  expect(err).toBeInstanceOf(Error);
});

test('exposes message, code and name', () => {
  const err = new ToolError('already registered', 'tool_already_registered');

  expect(err).toBeInstanceOf(Error);
  expect(err).toMatchObject({
    message: 'already registered',
    name: 'ToolError',
    code: 'tool_already_registered',
  });
});

test('keeps the original error as cause', () => {
  const original = new Error('boom');
  const err = new ToolError('wrapped', 'X', { cause: original });

  expect(err.cause).toBe(original);
});
