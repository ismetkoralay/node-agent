import { expectTypeOf, test } from 'vitest';
import type {
  AssistantMessage,
  ChatChunk,
  ChatRequest,
  ChatResponse,
  Message,
  ToolCall,
} from '../index.ts';

test('ChatRequest requires model and messages; the rest is optional', () => {
  expectTypeOf<ChatRequest['model']>().toBeString();
  expectTypeOf<ChatRequest['messages']>().toEqualTypeOf<Message[]>();
  expectTypeOf<{ model: string; messages: Message[] }>().toExtend<ChatRequest>();
  expectTypeOf<{ messages: Message[] }>().not.toExtend<ChatRequest>();
  expectTypeOf<ChatRequest['metadata']>().toEqualTypeOf<Record<string, string> | undefined>();
});

test('ChatChunk is a union discriminated by type', () => {
  expectTypeOf<ChatChunk['type']>().toEqualTypeOf<'text.delta' | 'tool_call' | 'finish'>();
  expectTypeOf<Extract<ChatChunk, { type: 'text.delta' }>>().toEqualTypeOf<{
    type: 'text.delta';
    text: string;
  }>();
  expectTypeOf<Extract<ChatChunk, { type: 'tool_call' }>['toolCall']>().toEqualTypeOf<ToolCall>();

  expectTypeOf<Extract<ChatChunk, { type: 'finish' }>['finishReason']>().toEqualTypeOf<
    ChatResponse['finishReason']
  >();
  expectTypeOf<Extract<ChatChunk, { type: 'finish' }>['usage']>().toEqualTypeOf<
    ChatResponse['usage']
  >();
  // usage is optional: a finish chunk without it is still a ChatChunk
  expectTypeOf<{ type: 'finish'; finishReason: 'stop' }>().toExtend<ChatChunk>();
});

test('ChatResponse carries an assistant message', () => {
  expectTypeOf<ChatResponse['message']>().toEqualTypeOf<AssistantMessage>();
  expectTypeOf<ChatResponse['finishReason']>().toEqualTypeOf<'stop' | 'tool_calls' | 'length'>();
});
