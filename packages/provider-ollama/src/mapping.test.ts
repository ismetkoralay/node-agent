import { type ChatRequest, ProviderError } from '@node-agent/core';
import type { ChatResponse as OllamaResponse } from 'ollama';
import { describe, expect, test } from 'vitest';
import { fromOllamaResponse, toOllamaRequest } from './mapping.ts';

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
});
