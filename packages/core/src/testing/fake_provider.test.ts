import { expect, test } from 'vitest';
import type { ChatRequest, ChatResponse } from '../types/index.ts';
import { FakeProvider } from './fake_provider.ts';
import { textResponse, toolCallResponse } from './responses.ts';

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

test('names the unanswered call when the script is exhausted', async () => {
  const provider = new FakeProvider([response, response]);
  await provider.chat(request);
  await provider.chat(request);

  await expect(provider.chat(request)).rejects.toThrow(
    'FakeProvider: no response scripted for call 3',
  );
});

test('rejects an already-aborted signal without consuming the script', async () => {
  const provider = new FakeProvider([response]);

  await expect(provider.chat(request, { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(provider.requests).toEqual([]);
  await expect(provider.chat(request)).resolves.toBe(response);
});

test('records a copy of the request, so a growing messages array does not rewrite history', async () => {
  const provider = new FakeProvider([response, response]);
  const messages: ChatRequest['messages'] = [{ role: 'user', content: 'hi' }];

  await provider.chat({ model: 'm', messages });
  messages.push({ role: 'assistant', content: 'hello' }, { role: 'user', content: 'more' });
  await provider.chat({ model: 'm', messages });

  expect(provider.requests[0]?.messages).toHaveLength(1);
  expect(provider.requests[1]?.messages).toHaveLength(3);
});

test('passes the request to a function response and returns its result', async () => {
  const provider = new FakeProvider([
    (req) => textResponse(`saw ${req.messages.length} message(s)`),
  ]);

  const result = await provider.chat(request);

  expect(result.message.content).toBe('saw 1 message(s)');
  expect(provider.requests).toHaveLength(1);
});

test('runs a two-turn tool call scenario and exposes the tool result in the second request', async () => {
  const provider = new FakeProvider([
    toolCallResponse([{ name: 'get_current_time', args: { timezone: 'UTC' } }]),
    textResponse('Bitti'),
  ]);

  const first = await provider.chat(request);
  const call = first.message.tool_calls?.[0];
  expect(call).toBeDefined();

  await provider.chat({
    model: 'm',
    messages: [
      ...request.messages,
      first.message,
      { role: 'tool', tool_call_id: call?.id ?? '', content: '12:00' },
    ],
  });

  expect(provider.requests[1]?.messages.at(-1)).toEqual({
    role: 'tool',
    tool_call_id: 'call_1',
    content: '12:00',
  });
});

test('waits delayMs before responding', async () => {
  const provider = new FakeProvider([response], { delayMs: 100 });

  const start = performance.now();
  await provider.chat(request);

  expect(performance.now() - start).toBeGreaterThanOrEqual(90);
});

test('aborts a pending delay immediately with signal.reason', async () => {
  const provider = new FakeProvider([response], { delayMs: 5_000 });
  const reason = new Error('stop');
  const controller = new AbortController();

  const start = performance.now();
  const call = provider.chat(request, { signal: controller.signal });
  // Abort after the call is already waiting; a pre-aborted signal would never reach the delay.
  controller.abort(reason);
  await expect(call).rejects.toBe(reason);
  expect(performance.now() - start).toBeLessThan(1_000);
});

test('rejects with the timeout reason when the signal fires during the delay', async () => {
  const provider = new FakeProvider([response], { delayMs: 5_000 });

  const start = performance.now();
  await expect(provider.chat(request, { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({
    name: 'TimeoutError',
  });
  expect(performance.now() - start).toBeLessThan(1_000);
});
