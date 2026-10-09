import { getEventListeners } from 'node:events';
import { type ChatRequest, ProviderError } from '@node-agent/core';
import type { ChatRequest as OllamaRequest, ChatResponse as OllamaResponse } from 'ollama';
import { describe, expect, test } from 'vitest';
import { OllamaProvider } from './index.ts';

function fakeClient(result: OllamaResponse | Error | Promise<OllamaResponse>) {
  const calls: OllamaRequest[] = [];
  return {
    calls,
    chat: async (req: OllamaRequest) => {
      calls.push(req);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const ok = {
  message: { role: 'assistant', content: 'Hello!' },
  done: true,
  done_reason: 'length',
  prompt_eval_count: 5,
  eval_count: 3,
} as OllamaResponse;

const request: ChatRequest = {
  model: 'llama3.2',
  messages: [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Hi' },
  ],
};

describe('OllamaProvider', () => {
  test('is named ollama', () => {
    expect(new OllamaProvider({ client: fakeClient(ok) as never }).name).toBe('ollama');
  });

  test('sends system + user messages to Ollama and maps the reply', async () => {
    const client = fakeClient(ok);
    const provider = new OllamaProvider({ client: client as never });

    const res = await provider.chat(request);

    expect(client.calls).toEqual([
      {
        model: 'llama3.2',
        stream: false,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Hi' },
        ],
      },
    ]);
    expect(res).toEqual({
      message: { role: 'assistant', content: 'Hello!' },
      finishReason: 'length',
      usage: { promptTokens: 5, completionTokens: 3 },
    });
  });

  test('wraps client errors in ProviderError and keeps the original as cause', async () => {
    const original = new Error('boom');
    const provider = new OllamaProvider({ client: fakeClient(original) as never });

    const err = await provider
      .chat({ ...request, messages: [...request.messages] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.cause).toBe(original);
    expect(err.provider).toBe('ollama');
  });

  test('connection failure is retryable', async () => {
    const provider = new OllamaProvider({
      client: fakeClient(new TypeError('fetch failed')) as never,
    });
    const err = await provider
      .chat({ ...request, messages: [...request.messages] })
      .catch((e) => e);
    expect(err.retryable).toBe(true);
  });

  test('404 tells the user to ollama pull the model and is not retryable', async () => {
    const notFound = Object.assign(new Error('model not found'), {
      name: 'ResponseError',
      status_code: 404,
    });
    const provider = new OllamaProvider({ client: fakeClient(notFound) as never });

    const err = await provider
      .chat({ ...request, messages: [...request.messages] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('ollama pull llama3.2');
    expect(err.retryable).toBe(false);
    expect(err.cause).toBe(notFound);
  });

  test('5xx is retryable, other 4xx is not', async () => {
    for (const [status, retryable] of [
      [503, true],
      [429, true],
      [400, false],
    ] as const) {
      const e = Object.assign(new Error('x'), { status_code: status });
      const provider = new OllamaProvider({ client: fakeClient(e) as never });
      const err = await provider
        .chat({ ...request, messages: [...request.messages] })
        .catch((x) => x);
      expect(err.retryable).toBe(retryable);
    }
  });

  test('an invalid history fails as a non-retryable ProviderError without calling Ollama', async () => {
    const client = fakeClient(ok);
    const provider = new OllamaProvider({ client: client as never });

    const err = await provider
      .chat({
        model: 'llama3.2',
        messages: [{ role: 'tool', tool_call_id: 'x', content: 'result' }],
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      message: expect.stringContaining('unknown tool_call_id "x"'),
      provider: 'ollama',
      retryable: false,
    });
    expect(client.calls).toEqual([]);
  });

  test('rejects with the abort reason when the signal fires mid-request', async () => {
    const never = new Promise<OllamaResponse>(() => {});
    const provider = new OllamaProvider({ client: fakeClient(never) as never });
    const controller = new AbortController();

    const pending = provider.chat(
      { ...request, messages: [...request.messages] },
      { signal: controller.signal },
    );
    controller.abort(new Error('stop'));

    await expect(pending).rejects.toThrow('stop');
  });

  test('leaves no abort listener on a reused signal after success or failure', async () => {
    const controller = new AbortController();
    const { signal } = controller;
    const req = () => ({ ...request, messages: [...request.messages] });

    const okProvider = new OllamaProvider({ client: fakeClient(ok) as never });
    const failProvider = new OllamaProvider({ client: fakeClient(new Error('boom')) as never });
    for (let i = 0; i < 20; i++) {
      await okProvider.chat(req(), { signal });
      await failProvider.chat(req(), { signal }).catch(() => {});
    }

    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

  test('rejects immediately for an already-aborted signal without calling Ollama', async () => {
    const client = fakeClient(ok);
    const provider = new OllamaProvider({ client: client as never });

    await expect(
      provider.chat(
        { ...request, messages: [...request.messages] },
        { signal: AbortSignal.abort() },
      ),
    ).rejects.toThrow();
    expect(client.calls).toHaveLength(0);
  });

  test('rejects when done_reason is unknown', async () => {
    const ok = {
      message: { role: 'assistant', content: 'Hello!' },
      done: true,
      done_reason: 'length',
      prompt_eval_count: 5,
      eval_count: 3,
    } as OllamaResponse;
    const client = fakeClient({
      ...ok,
      done_reason: 'unknown',
    });
    const provider = new OllamaProvider({ client: client as never });

    const err = await provider
      .chat({ ...request, messages: [...request.messages] })
      .catch((e) => e);

    expect(client.calls).toHaveLength(1);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Unexpected Ollama done_reason: unknown');
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(false);
  });
});
