import {
  type ChatRequest,
  type Message,
  ProviderError,
  type ToolDefinition,
} from '@node-agent/core';
import type { ChatResponse as OllamaResponse } from 'ollama';
import { describe, expect, test } from 'vitest';
import { fromOllamaResponse, toOllamaRequest } from './mapping.ts';

const getCurrentTime: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_current_time',
    description: 'Returns the current time in a timezone.',
    parameters: { type: 'object', properties: { timezone: { type: 'string' } } },
  },
};

const call = (id: string, name: string, args: string) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: args },
});

const assistantCalling = (tool_calls: ReturnType<typeof call>[]): Message => ({
  role: 'assistant',
  content: null,
  tool_calls,
});

describe('toOllamaRequest', () => {
  test('maps messages and forces stream: false', () => {
    const req: ChatRequest = {
      model: 'llama3.2',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: null },
      ],
    };
    expect(toOllamaRequest(req)).toEqual({
      model: 'llama3.2',
      stream: false,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: '' },
      ],
    });
  });

  test.each([
    [{ temperature: 0.2 }, { temperature: 0.2 }],
    [{ maxTokens: 64 }, { num_predict: 64 }],
    [
      { temperature: 0, maxTokens: 1 },
      { temperature: 0, num_predict: 1 },
    ],
  ])('maps sampling fields %j', (extra, options) => {
    const out = toOllamaRequest({ model: 'm', messages: [], ...extra });
    expect(out.options).toEqual(options);
  });

  test('omits options when none are set', () => {
    expect(toOllamaRequest({ model: 'm', messages: [] })).not.toHaveProperty('options');
  });

  test('omits tools when none are set', () => {
    expect(toOllamaRequest({ model: 'm', messages: [] })).not.toHaveProperty('tools');
  });

  test('maps tool definitions', () => {
    const out = toOllamaRequest({ model: 'm', messages: [], tools: [getCurrentTime] });
    expect(out.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: 'Returns the current time in a timezone.',
          parameters: getCurrentTime.function.parameters,
        },
      },
    ]);
  });

  test('maps assistant tool_calls: string arguments become an object, ids are dropped', () => {
    const out = toOllamaRequest({
      model: 'm',
      messages: [assistantCalling([call('call_1', 'get_current_time', '{"timezone":"UTC"}')])],
    });
    expect(out.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'get_current_time', arguments: { timezone: 'UTC' } } }],
      },
    ]);
  });

  test('maps a tool result to the tool name of the call it answers', () => {
    const out = toOllamaRequest({
      model: 'm',
      messages: [
        { role: 'user', content: 'What time is it?' },
        assistantCalling([
          call('call_1', 'get_current_time', '{}'),
          call('call_2', 'get_weather', '{"city":"Ankara"}'),
        ]),
        { role: 'tool', tool_call_id: 'call_2', content: 'sunny' },
        { role: 'tool', tool_call_id: 'call_1', content: '12:00' },
      ],
    });
    expect((out.messages ?? []).slice(2)).toEqual([
      { role: 'tool', content: 'sunny', tool_name: 'get_weather' },
      { role: 'tool', content: '12:00', tool_name: 'get_current_time' },
    ]);
  });

  test('resolves a reused id against the nearest preceding assistant message', () => {
    const out = toOllamaRequest({
      model: 'm',
      messages: [
        assistantCalling([call('call_1', 'first_tool', '{}')]),
        { role: 'tool', tool_call_id: 'call_1', content: 'a' },
        assistantCalling([call('call_1', 'second_tool', '{}')]),
        { role: 'tool', tool_call_id: 'call_1', content: 'b' },
      ],
    });
    expect((out.messages ?? []).filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', content: 'a', tool_name: 'first_tool' },
      { role: 'tool', content: 'b', tool_name: 'second_tool' },
    ]);
  });

  test.each([
    ['no preceding assistant message', [{ role: 'tool', tool_call_id: 'x', content: 'r' }]],
    [
      'no matching tool call',
      [
        assistantCalling([call('call_1', 'get_current_time', '{}')]),
        { role: 'tool', tool_call_id: 'x', content: 'r' },
      ],
    ],
  ] as [string, Message[]][])(
    'tool result with %s -> non-retryable ProviderError',
    (_, messages) => {
      const act = () => toOllamaRequest({ model: 'm', messages });
      expect(act).toThrow(ProviderError);
      expect(act).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('"x"'),
          provider: 'ollama',
          retryable: false,
        }),
      );
    },
  );

  test.each([['{not json'], ['"a string"'], ['[1]'], ['null']])(
    'tool call arguments %s -> non-retryable ProviderError',
    (args) => {
      const act = () =>
        toOllamaRequest({
          model: 'm',
          messages: [assistantCalling([call('call_1', 'get_current_time', args)])],
        });
      expect(act).toThrow(ProviderError);
      expect(act).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('get_current_time'),
          provider: 'ollama',
          retryable: false,
        }),
      );
    },
  );
});

describe('fromOllamaResponse', () => {
  const base = (over: Partial<OllamaResponse>): OllamaResponse =>
    ({
      model: 'm',
      message: { role: 'assistant', content: 'hello' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 11,
      eval_count: 7,
      ...over,
    }) as OllamaResponse;

  test.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['unload', 'stop'],
    ['load', 'stop'],
  ])('done_reason %s -> finishReason %s', (doneReason, finishReason) => {
    const out = fromOllamaResponse(base({ done_reason: doneReason as string }));
    expect(out.finishReason).toBe(finishReason);
  });

  test.each([[undefined], [null], ['unknown']])(
    'done_reason %s -> non-retryable ProviderError',
    (doneReason) => {
      const act = () => fromOllamaResponse(base({ done_reason: doneReason as string }));

      expect(act).toThrow(ProviderError);
      expect(act).toThrow(
        expect.objectContaining({
          message: `Unexpected Ollama done_reason: ${doneReason}`,
          code: 'provider_error',
          provider: 'ollama',
          retryable: false,
        }),
      );
    },
  );

  test('maps content and usage', () => {
    expect(fromOllamaResponse(base({}))).toEqual({
      message: { role: 'assistant', content: 'hello' },
      finishReason: 'stop',
      usage: { promptTokens: 11, completionTokens: 7 },
    });
  });

  test('omits usage when counts are missing', () => {
    const out = fromOllamaResponse(
      base({ prompt_eval_count: undefined, eval_count: undefined } as Partial<OllamaResponse>),
    );
    expect(out).not.toHaveProperty('usage');
  });

  describe('tool calls', () => {
    const withCalls = (...calls: { name: string; arguments: Record<string, unknown> }[]) =>
      base({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: calls.map((function_) => ({ function: function_ })),
        },
      });

    test('maps one tool call: arguments become a JSON string and an id is generated', () => {
      const out = fromOllamaResponse(
        withCalls({ name: 'get_current_time', arguments: { timezone: 'UTC' } }),
        () => 'call_abc',
      );
      expect(out).toMatchObject({
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_abc',
              type: 'function',
              function: { name: 'get_current_time', arguments: '{"timezone":"UTC"}' },
            },
          ],
        },
        finishReason: 'tool_calls',
      });
    });

    test('maps two tool calls to two calls with distinct ids', () => {
      const out = fromOllamaResponse(
        withCalls({ name: 'a', arguments: {} }, { name: 'b', arguments: { x: 1 } }),
      );
      const calls = out.message.tool_calls ?? [];
      expect(calls.map((c) => c.function.name)).toEqual(['a', 'b']);
      expect(calls[0]?.id).toBeTruthy();
      expect(calls[0]?.id).not.toBe(calls[1]?.id);
    });

    test('the default id generator yields call_-prefixed ids', () => {
      const out = fromOllamaResponse(withCalls({ name: 'a', arguments: {} }));
      expect(out.message.tool_calls?.[0]?.id).toMatch(/^call_.+/);
    });

    test('omits tool_calls when the model made none', () => {
      expect(fromOllamaResponse(base({})).message).not.toHaveProperty('tool_calls');
    });

    test('round trip keeps name and arguments; the id is regenerated', () => {
      const original = call('call_1', 'get_weather', '{"city":"Ankara","days":2}');
      const ollamaRequest = toOllamaRequest({
        model: 'm',
        messages: [assistantCalling([original])],
      });
      const [sent] = ollamaRequest.messages ?? [];

      const back = fromOllamaResponse(
        base({ message: { role: 'assistant', content: '', tool_calls: sent?.tool_calls } }),
        () => 'call_new',
      );
      expect(back.message.tool_calls).toEqual([{ ...original, id: 'call_new' }]);
    });
  });
});
