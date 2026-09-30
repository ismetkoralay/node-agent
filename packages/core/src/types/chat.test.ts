import { expectTypeOf, test } from 'vitest';
import type { AssistantMessage, ChatRequest, ChatResponse, Message } from '../index.ts';

test('ChatRequest requires model and messages; the rest is optional', () => {
  expectTypeOf<ChatRequest['model']>().toBeString();
  expectTypeOf<ChatRequest['messages']>().toEqualTypeOf<Message[]>();
  expectTypeOf<{ model: string; messages: Message[] }>().toExtend<ChatRequest>();
  expectTypeOf<{ messages: Message[] }>().not.toExtend<ChatRequest>();
  expectTypeOf<ChatRequest['metadata']>().toEqualTypeOf<Record<string, string> | undefined>();
});

test('ChatResponse carries an assistant message', () => {
  expectTypeOf<ChatResponse['message']>().toEqualTypeOf<AssistantMessage>();
  expectTypeOf<ChatResponse['finishReason']>().toEqualTypeOf<'stop' | 'tool_calls' | 'length'>();
});
