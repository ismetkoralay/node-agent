import { describe, expect, test, vi } from 'vitest';
import { AgentError } from '../errors/agent_error.ts';
import { textResponse, toolCallResponse } from '../testing/responses.ts';
import type { ChatChunk, ChatResponse } from '../types/chat.ts';
import type { ToolCall } from '../types/tool.ts';
import { ChunkCollector, collectStream, responseToChunks } from './collect_stream.ts';

const wordSplit = (text: string): string[] => text.match(/\S+\s*|\s+/g) ?? [text];

const callA: ToolCall = {
  id: 'call_1',
  type: 'function',
  function: { name: 'a', arguments: '{"x":1}' },
};
const callB: ToolCall = {
  id: 'call_2',
  type: 'function',
  function: { name: 'b', arguments: '{}' },
};
const usage = { promptTokens: 3, completionTokens: 5 };

const delta = (text: string): ChatChunk => ({ type: 'text.delta', text });
const call = (toolCall: ToolCall): ChatChunk => ({ type: 'tool_call', toolCall });
const finish = (
  finishReason: ChatResponse['finishReason'] = 'stop',
  withUsage?: ChatResponse['usage'],
): ChatChunk =>
  withUsage ? { type: 'finish', finishReason, usage: withUsage } : { type: 'finish', finishReason };

function collect(chunks: ChatChunk[]): ChatResponse {
  const collector = new ChunkCollector();
  for (const chunk of chunks) collector.add(chunk);
  return collector.response();
}

async function* asyncChunks(chunks: ChatChunk[]): AsyncGenerator<ChatChunk> {
  for (const chunk of chunks) yield chunk;
}

const alreadyFinished = {
  code: 'stream_already_finished',
  message: 'Cannot add more chunks after the stream has finished',
};
const notFinished = {
  code: 'stream_not_finished',
  message: 'Cannot build a response before the stream has finished',
};
const invalidSplit = {
  code: 'invalid_split',
  message: 'The split function must return parts that concatenate back to the original text',
};

/** Matches an `AgentError` with exactly this code and message. */
const agentError = (expected: { code: string; message: string }) =>
  expect.objectContaining({ name: 'AgentError', ...expected });

describe('ChunkCollector', () => {
  test.each<{ name: string; chunks: ChatChunk[]; expected: ChatResponse }>([
    {
      name: 'concatenates text deltas',
      chunks: [delta('a'), delta('b'), finish()],
      expected: textResponse('ab'),
    },
    {
      name: 'passes usage through',
      chunks: [delta('hi'), finish('stop', usage)],
      expected: { ...textResponse('hi'), usage },
    },
    {
      name: 'keeps finishReason length',
      chunks: [delta('cut'), finish('length')],
      expected: { message: { role: 'assistant', content: 'cut' }, finishReason: 'length' },
    },
    {
      name: 'tool calls only: content is null, calls keep their order',
      chunks: [call(callA), call(callB), finish('tool_calls')],
      expected: {
        message: { role: 'assistant', content: null, tool_calls: [callA, callB] },
        finishReason: 'tool_calls',
      },
    },
    {
      name: 'text plus tool call: content stays the text',
      chunks: [delta('x'), call(callA), finish('tool_calls')],
      expected: {
        message: { role: 'assistant', content: 'x', tool_calls: [callA] },
        finishReason: 'tool_calls',
      },
    },
    {
      name: 'empty delta plus tool call: content is null',
      chunks: [delta(''), call(callA), finish('tool_calls')],
      expected: {
        message: { role: 'assistant', content: null, tool_calls: [callA] },
        finishReason: 'tool_calls',
      },
    },
    {
      name: 'no text and no tool calls: content is an empty string',
      chunks: [finish()],
      expected: textResponse(''),
    },
  ])('$name', ({ chunks, expected }) => {
    expect(collect(chunks)).toStrictEqual(expected);
  });

  test('response() before finish throws stream_not_finished', () => {
    const collector = new ChunkCollector();
    collector.add(delta('partial'));
    expect(() => collector.response()).toThrow(agentError(notFinished));
  });

  test('add() after finish throws stream_already_finished', () => {
    const collector = new ChunkCollector();
    collector.add(finish());
    expect(() => collector.add(delta('late'))).toThrow(agentError(alreadyFinished));
    expect(() => collector.add(finish())).toThrow(agentError(alreadyFinished));
  });

  test('a rejected chunk does not change the response', () => {
    const collector = new ChunkCollector();
    collector.add(delta('a'));
    collector.add(finish());
    expect(() => collector.add(delta('b'))).toThrow(agentError(alreadyFinished));
    expect(collector.response()).toStrictEqual(textResponse('a'));
  });

  test('response() can be called twice and returns a fresh tool_calls array each time', () => {
    const collector = new ChunkCollector();
    collector.add(call(callA));
    collector.add(finish('tool_calls'));

    const first = collector.response();
    const second = collector.response();
    expect(second).toStrictEqual(first);

    first.message.tool_calls?.pop();
    expect(collector.response().message.tool_calls).toStrictEqual([callA]);
  });

  test('tool call objects and usage are shared with the chunks, not copied', () => {
    const res = collect([call(callA), finish('tool_calls', usage)]);
    expect(res.message.tool_calls?.[0]).toBe(callA);
    expect(res.usage).toBe(usage);
  });

  test('keeps tool calls in arrival order when text comes after them', () => {
    expect(
      collect([call(callA), delta('x'), call(callB), finish('tool_calls')]).message,
    ).toStrictEqual({
      role: 'assistant',
      content: 'x',
      tool_calls: [callA, callB],
    });
  });

  test('rejects a chunk of an unknown type', () => {
    const collector = new ChunkCollector();
    expect(() => collector.add({ type: 'bogus' } as unknown as ChatChunk)).toThrow(
      agentError({ code: 'unknown_chunk_type', message: 'Unknown chunk type "bogus"' }),
    );
  });
});

describe('collectStream', () => {
  test('collects an async source', async () => {
    const res = await collectStream(asyncChunks([delta('a'), delta('b'), finish('stop', usage)]));
    expect(res).toStrictEqual({ ...textResponse('ab'), usage });
  });

  test('collects a sync iterable', async () => {
    const res = await collectStream([delta('a'), call(callA), finish('tool_calls')]);
    expect(res.message).toStrictEqual({ role: 'assistant', content: 'a', tool_calls: [callA] });
  });

  test('rejects with stream_not_finished when the source ends without finish', async () => {
    await expect(collectStream(asyncChunks([delta('a')]))).rejects.toThrow(agentError(notFinished));
  });

  test('rejects with stream_already_finished when a chunk follows finish', async () => {
    await expect(collectStream(asyncChunks([finish(), delta('late')]))).rejects.toThrow(
      agentError(alreadyFinished),
    );
  });

  test('propagates the error of a source that throws mid-stream', async () => {
    const boom = new Error('boom');
    async function* failing(): AsyncGenerator<ChatChunk> {
      yield delta('a');
      throw boom;
    }
    await expect(collectStream(failing())).rejects.toBe(boom);
  });

  test('closes the source when the collector rejects a chunk', async () => {
    const cleanup = vi.fn();
    async function* source(): AsyncGenerator<ChatChunk> {
      try {
        yield finish();
        yield delta('late');
      } finally {
        cleanup();
      }
    }
    await expect(collectStream(source())).rejects.toBeInstanceOf(AgentError);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe('responseToChunks', () => {
  test.each<{
    name: string;
    response: ChatResponse;
    split?: typeof wordSplit;
    chunks: ChatChunk[];
  }>([
    {
      name: 'whole text is one delta by default',
      response: textResponse('hello world'),
      chunks: [delta('hello world'), finish()],
    },
    {
      name: 'split cuts the text, keeping whitespace on the previous piece',
      response: textResponse('It is 23:10.'),
      split: wordSplit,
      chunks: [delta('It '), delta('is '), delta('23:10.'), finish()],
    },
    {
      name: 'leading whitespace survives the word split',
      response: textResponse('  hi there'),
      split: wordSplit,
      chunks: [delta('  '), delta('hi '), delta('there'), finish()],
    },
    {
      name: 'null content with tool calls: no deltas',
      response: toolCallResponse([
        { name: 'a', args: { x: 1 } },
        { name: 'b', args: {} },
      ]),
      chunks: [call(callA), call(callB), finish('tool_calls')],
    },
    {
      name: 'empty content: only finish',
      response: textResponse(''),
      chunks: [finish()],
    },
    {
      name: 'text before tool calls, then finish',
      response: {
        message: { role: 'assistant', content: 'x', tool_calls: [callA, callB] },
        finishReason: 'tool_calls',
      },
      chunks: [delta('x'), call(callA), call(callB), finish('tool_calls')],
    },
    {
      name: 'finish carries usage when present',
      response: { ...textResponse('hi'), usage },
      chunks: [delta('hi'), finish('stop', usage)],
    },
    {
      name: 'finish has no usage key when absent',
      response: textResponse('hi'),
      chunks: [delta('hi'), finish()],
    },
    {
      name: 'finishReason is copied as is',
      response: { message: { role: 'assistant', content: 'cut' }, finishReason: 'length' },
      chunks: [delta('cut'), finish('length')],
    },
    {
      name: 'empty pieces from split are dropped',
      response: textResponse('ab'),
      split: () => ['', 'a', '', 'b'],
      chunks: [delta('a'), delta('b'), finish()],
    },
  ])('$name', ({ response, split, chunks }) => {
    expect([...responseToChunks(response, split)]).toStrictEqual(chunks);
  });

  test('ends with exactly one finish and nothing after it', () => {
    const chunks = [...responseToChunks(textResponse('a b'), wordSplit)];
    expect(chunks.filter((c) => c.type === 'finish')).toHaveLength(1);
    expect(chunks.at(-1)?.type).toBe('finish');
  });

  test.each([
    { name: 'altered text', split: () => ['x'] },
    { name: 'dropped text', split: (t: string) => [t.slice(1)] },
    { name: 'no parts', split: () => [] },
  ])('a split that does not rejoin ($name) throws invalid_split', ({ split }) => {
    expect(() => [...responseToChunks(textResponse('abc'), split)]).toThrow(
      agentError(invalidSplit),
    );
  });

  test('invalid_split is thrown on the first next(), before any chunk', () => {
    const gen = responseToChunks(textResponse('abc'), () => ['x']);
    expect(() => gen.next()).toThrow(agentError(invalidSplit));
  });

  test('split is called once with the exact content', () => {
    const split = vi.fn(wordSplit);
    [...responseToChunks(textResponse('It is 23:10.'), split)];
    expect(split).toHaveBeenCalledExactlyOnceWith('It is 23:10.');
  });

  test.each([
    { name: 'empty content', response: textResponse('') },
    { name: 'null content', response: toolCallResponse([{ name: 'a', args: {} }]) },
  ])('split is not called for $name', ({ response }) => {
    const split = vi.fn(wordSplit);
    [...responseToChunks(response, split)];
    expect(split).not.toHaveBeenCalled();
  });
});

describe('collectStream(responseToChunks(r))', () => {
  const identity: { name: string; response: ChatResponse }[] = [
    { name: 'text', response: textResponse('It is 23:10.\nDone.') },
    { name: 'text with usage', response: { ...textResponse('hi there'), usage } },
    { name: 'empty text', response: textResponse('') },
    {
      name: 'tool calls',
      response: toolCallResponse([
        { name: 'a', args: { x: 1 } },
        { name: 'b', args: {} },
      ]),
    },
    {
      name: 'tool calls with usage',
      response: { ...toolCallResponse([{ name: 'a', args: { x: 1 } }]), usage },
    },
    {
      name: 'text plus tool calls',
      response: {
        message: { role: 'assistant', content: 'x', tool_calls: [callA] },
        finishReason: 'tool_calls',
      },
    },
    {
      name: 'finishReason length',
      response: { message: { role: 'assistant', content: 'cut' }, finishReason: 'length' },
    },
  ];

  test.each(
    identity.flatMap(({ name, response }) => [
      { name: `${name}, whole`, response, split: undefined },
      { name: `${name}, word by word`, response, split: wordSplit },
    ]),
  )('round-trips $name', async ({ response, split }) => {
    expect(await collectStream(responseToChunks(response, split))).toStrictEqual(response);
  });

  test.each<{ name: string; response: ChatResponse; expected: ChatResponse }>([
    {
      name: "'' content with tool calls becomes null",
      response: {
        message: { role: 'assistant', content: '', tool_calls: [callA] },
        finishReason: 'tool_calls',
      },
      expected: {
        message: { role: 'assistant', content: null, tool_calls: [callA] },
        finishReason: 'tool_calls',
      },
    },
    {
      name: 'null content without tool calls becomes an empty string',
      response: { message: { role: 'assistant', content: null }, finishReason: 'length' },
      expected: { message: { role: 'assistant', content: '' }, finishReason: 'length' },
    },
    {
      name: 'an empty tool_calls array is dropped',
      response: {
        message: { role: 'assistant', content: 'hi', tool_calls: [] },
        finishReason: 'stop',
      },
      expected: textResponse('hi'),
    },
  ])('documented normalisation: $name', async ({ response, expected }) => {
    expect(await collectStream(responseToChunks(response))).toStrictEqual(expected);
  });
});
