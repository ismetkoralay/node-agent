import { expect, test } from 'vitest';
import { collectStream } from '../provider/collect_stream.ts';
import type { LLMProvider } from '../provider/llm_provider.ts';
import type { ChatChunk, ChatRequest, ChatResponse } from '../types/index.ts';
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

async function drain(chunks: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

test('stream yields the text word by word, each word keeping its trailing space', async () => {
  const provider = new FakeProvider([textResponse('It is 23:10.')]);

  const chunks = await drain(provider.stream(request));

  expect(chunks).toEqual([
    { type: 'text.delta', text: 'It ' },
    { type: 'text.delta', text: 'is ' },
    { type: 'text.delta', text: '23:10.' },
    { type: 'finish', finishReason: 'stop' },
  ]);
});

test('the words join back to the original text, whatever the whitespace', async () => {
  const text = '  two  spaces,\nnew line\tand a tab ';
  const provider = new FakeProvider([textResponse(text)]);

  const chunks = await drain(provider.stream(request));

  const joined = chunks.map((c) => (c.type === 'text.delta' ? c.text : '')).join('');
  expect(joined).toBe(text);
});

test('collectStream(stream) equals chat for a text answer', async () => {
  const script = [
    {
      ...textResponse('The answer is 42, as always.'),
      usage: { promptTokens: 3, completionTokens: 7 },
    },
  ];

  const viaChat = await new FakeProvider(script).chat(request);
  const viaStream = await collectStream(new FakeProvider(script).stream(request));

  expect(viaStream).toEqual(viaChat);
});

test('collectStream(stream) equals chat for a tool call answer', async () => {
  const script = [
    toolCallResponse([
      { name: 'get_current_time', args: { timezone: 'UTC' } },
      { name: 'calculator', args: { expression: '1+1' } },
    ]),
  ];

  const viaChat = await new FakeProvider(script).chat(request);
  const viaStream = await collectStream(new FakeProvider(script).stream(request));

  expect(viaStream).toEqual(viaChat);
  expect(viaStream.message.content).toBeNull();
});

test('stream consumes the script and records the request like chat', async () => {
  const provider = new FakeProvider([textResponse('one'), textResponse('two')]);

  await drain(provider.stream(request));
  await expect(provider.chat(request)).resolves.toMatchObject({ message: { content: 'two' } });

  expect(provider.requests).toEqual([request, request]);
});

test('stream passes the request to a function step', async () => {
  const provider = new FakeProvider([
    (req) => textResponse(`saw ${req.messages.length} message(s)`),
  ]);

  const result = await collectStream(provider.stream(request));

  expect(result.message.content).toBe('saw 1 message(s)');
});

test('a scripted error surfaces when the stream is iterated', async () => {
  const boom = new Error('boom');
  const provider = new FakeProvider([boom]);

  await expect(drain(provider.stream(request))).rejects.toBe(boom);
});

test('an exhausted script fails the stream with the same message as chat', async () => {
  const provider = new FakeProvider([]);

  await expect(drain(provider.stream(request))).rejects.toThrow(
    'FakeProvider: no response scripted for call 1',
  );
});

test('an already-aborted signal fails the stream without consuming the script', async () => {
  const provider = new FakeProvider([textResponse('hi')]);

  await expect(drain(provider.stream(request, { signal: AbortSignal.abort() }))).rejects.toThrow();
  expect(provider.requests).toEqual([]);
  await expect(provider.chat(request)).resolves.toMatchObject({ message: { content: 'hi' } });
});

test('aborting between chunks ends the stream with signal.reason', async () => {
  const provider = new FakeProvider([textResponse('one two three four')]);
  const reason = new Error('stop');
  const controller = new AbortController();
  const seen: ChatChunk[] = [];

  const read = async () => {
    for await (const chunk of provider.stream(request, { signal: controller.signal })) {
      seen.push(chunk);
      if (seen.length === 2) controller.abort(reason);
    }
  };

  await expect(read()).rejects.toBe(reason);
  expect(seen).toHaveLength(2);
});

test('chunkDelayMs waits between chunks, not before the first', async () => {
  const provider = new FakeProvider([textResponse('a b c')], { chunkDelayMs: 60 });
  const stamps: number[] = [];
  const start = performance.now();

  for await (const chunk of provider.stream(request)) {
    if (chunk.type === 'text.delta') stamps.push(performance.now() - start);
  }

  expect(stamps[0]).toBeLessThan(40);
  expect(stamps[1]).toBeGreaterThanOrEqual(50);
  expect(stamps[2]).toBeGreaterThanOrEqual(110);
});

test('aborting during a chunk delay ends the stream at once with signal.reason', async () => {
  const provider = new FakeProvider([textResponse('a b c')], { chunkDelayMs: 5_000 });
  const reason = new Error('stop');
  const controller = new AbortController();
  const start = performance.now();

  const read = async () => {
    for await (const chunk of provider.stream(request, { signal: controller.signal })) {
      if (chunk.type === 'text.delta') controller.abort(reason);
    }
  };

  await expect(read()).rejects.toBe(reason);
  expect(performance.now() - start).toBeLessThan(1_000);
});

test('a chat-only wrapper around the fake still satisfies LLMProvider', async () => {
  const fake = new FakeProvider([textResponse('hi')]);
  const chatOnly: LLMProvider = { name: 'chat-only', chat: (r, o) => fake.chat(r, o) };

  expect(chatOnly.stream).toBeUndefined();
  await expect(chatOnly.chat(request)).resolves.toMatchObject({ message: { content: 'hi' } });
});
