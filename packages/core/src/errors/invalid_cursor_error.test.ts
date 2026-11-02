import { expect, test } from 'vitest';
import { AgentError } from './agent_error.ts';
import { InvalidCursorError } from './invalid_cursor_error.ts';

test('is an AgentError and an Error', () => {
  const err = new InvalidCursorError();

  expect(err).toBeInstanceOf(InvalidCursorError);
  expect(err).toBeInstanceOf(AgentError);
  expect(err).toBeInstanceOf(Error);
});

test('exposes message, code and name', () => {
  expect(new InvalidCursorError()).toMatchObject({
    message: 'The cursor is not valid',
    name: 'InvalidCursorError',
    code: 'invalid_cursor',
  });
});

test('keeps the original error as cause', () => {
  const original = new SyntaxError('Unexpected token');

  expect(new InvalidCursorError({ cause: original }).cause).toBe(original);
});
