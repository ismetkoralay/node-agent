import { expect, expectTypeOf, test } from 'vitest';
import type { ChatChunk, ChatRequest, ChatResponse } from '../types/index.ts';
import type { LLMProvider } from './index.ts';

test('LLMProvider exposes a readonly name and a chat method', () => {
  expectTypeOf<LLMProvider['name']>().toBeString();
  expectTypeOf<LLMProvider>().toHaveProperty('name').toEqualTypeOf<string>();
  expectTypeOf<LLMProvider['chat']>().toEqualTypeOf<
    (request: ChatRequest, opts?: { signal?: AbortSignal }) => Promise<ChatResponse>
  >();
});

test('chat options are optional', () => {
  expectTypeOf<LLMProvider['chat']>().toBeCallableWith({ model: 'm', messages: [] });
  expectTypeOf<LLMProvider['chat']>().toBeCallableWith(
    { model: 'm', messages: [] },
    { signal: new AbortController().signal },
  );
});

test('a minimal object satisfies LLMProvider', () => {
  const minimal = {
    name: 'minimal',
    chat: async (): Promise<ChatResponse> => ({
      message: { role: 'assistant', content: 'ok' },
      finishReason: 'stop',
    }),
  };
  expectTypeOf(minimal).toExtend<LLMProvider>();
  expectTypeOf<{ name: string }>().not.toExtend<LLMProvider>();
});

test('stream is optional and returns an AsyncIterable of chunks', () => {
  expectTypeOf<LLMProvider['stream']>().toEqualTypeOf<
    | ((request: ChatRequest, opts?: { signal?: AbortSignal }) => AsyncIterable<ChatChunk>)
    | undefined
  >();
  expectTypeOf<{ name: string; chat: LLMProvider['chat'] }>().toExtend<LLMProvider>();
});

test('a provider with a stream method satisfies LLMProvider', async () => {
  const streaming = {
    name: 'streaming',
    chat: async (): Promise<ChatResponse> => ({
      message: { role: 'assistant', content: 'ok' },
      finishReason: 'stop',
    }),
    async *stream(): AsyncGenerator<ChatChunk> {
      yield { type: 'text.delta', text: 'ok' };
      yield { type: 'finish', finishReason: 'stop' };
    },
  };
  expectTypeOf(streaming).toExtend<LLMProvider>();

  const provider: LLMProvider = streaming;
  const chunks: ChatChunk[] = [];
  for await (const chunk of provider.stream?.({ model: 'm', messages: [] }) ?? []) {
    chunks.push(chunk);
  }
  expect(chunks.map((c) => c.type)).toEqual(['text.delta', 'finish']);
});

test('a five-line class can implement LLMProvider', async () => {
  class Echo implements LLMProvider {
    readonly name = 'echo';
    async chat(req: ChatRequest): Promise<ChatResponse> {
      return { message: { role: 'assistant', content: req.model }, finishReason: 'stop' };
    }
  }

  const res = await new Echo().chat({ model: 'm', messages: [] });
  expect(res.message.content).toBe('m');
});
