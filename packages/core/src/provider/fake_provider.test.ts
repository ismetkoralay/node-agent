import { expect, test } from 'vitest';
import type { ChatRequest, ChatResponse } from '../types/index.ts';
import { FakeProvider } from './fake_provider.ts';

const request: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
const response: ChatResponse = {
  message: { role: 'assistant', content: 'hello' },
  finishReason: 'stop',
};

test('returns scripted responses in order and records requests', async () => {
  const second: ChatResponse = { ...response, message: { role: 'assistant', content: 'again' } };
  const provider = new FakeProvider([response, second]);

  await expect(provider.chat(request)).resolves.toBe(response);
  await expect(provider.chat(request)).resolves.toBe(second);
  expect(provider.requests).toEqual([request, request]);
});

test('throws a scripted error', async () => {
  const boom = new Error('boom');
  const provider = new FakeProvider([boom]);

  await expect(provider.chat(request)).rejects.toBe(boom);
});

test('fails loudly when the script is exhausted', async () => {
  const provider = new FakeProvider([response]);
  await provider.chat(request);

  await expect(provider.chat(request)).rejects.toThrow(/script exhausted after 1 call/);
});

test('rejects an already-aborted signal without consuming the script', async () => {
  const provider = new FakeProvider([response]);

  await expect(provider.chat(request, { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(provider.requests).toEqual([]);
  await expect(provider.chat(request)).resolves.toBe(response);
});
