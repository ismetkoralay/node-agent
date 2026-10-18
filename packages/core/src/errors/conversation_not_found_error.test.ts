import { expect, test } from 'vitest';
import { AgentError } from './agent_error.ts';
import { ConversationNotFoundError } from './conversation_not_found_error.ts';

test('is an AgentError and an Error', () => {
  const err = new ConversationNotFoundError('conv-1');

  expect(err).toBeInstanceOf(ConversationNotFoundError);
  expect(err).toBeInstanceOf(AgentError);
  expect(err).toBeInstanceOf(Error);
});

test('exposes message, code, name and conversationId', () => {
  const err = new ConversationNotFoundError('conv-1');

  expect(err).toMatchObject({
    message: 'Conversation conv-1 not found',
    name: 'ConversationNotFoundError',
    code: 'conversation_not_found',
    conversationId: 'conv-1',
  });
});

test('keeps the original error as cause', () => {
  const original = new Error('boom');
  const err = new ConversationNotFoundError('conv-1', { cause: original });

  expect(err.cause).toBe(original);
});
