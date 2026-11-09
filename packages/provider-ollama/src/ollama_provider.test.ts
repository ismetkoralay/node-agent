import { getEventListeners } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type ChatChunk, type ChatRequest, collectStream, ProviderError } from '@node-agent/core';
import type { ChatRequest as OllamaRequest, ChatResponse as OllamaResponse } from 'ollama';
import { afterEach, describe, expect, test } from 'vitest';
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
    const reason = new Error('stop');
    controller.abort(reason);

    // `toBe`, not `toThrow('stop')`: a wrapped error would carry "stop" in its message too.
    await expect(pending).rejects.toBe(reason);
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

const part = (content: string, over: Record<string, unknown> = {}): OllamaResponse =>
  ({ model: 'm', done: false, message: { role: 'assistant', content }, ...over }) as OllamaResponse;

const donePart = (over: Record<string, unknown> = {}): OllamaResponse =>
  part('', { done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 3, ...over });

const toolPart = (name: string, args: Record<string, unknown>): OllamaResponse =>
  ({
    model: 'm',
    done: false,
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name, arguments: args } }],
    },
  }) as OllamaResponse;

/** What `ollama`'s `chat({ stream: true })` resolves to: an async iterator that can be aborted. */
function fakeParts(parts: OllamaResponse[], opts: { hang?: boolean; failWith?: Error } = {}) {
  let release: ((err: Error) => void) | undefined;
  const state = { aborts: 0 };
  return {
    state,
    abort() {
      state.aborts++;
      release?.(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    },
    async *[Symbol.asyncIterator]() {
      for (const p of parts) yield p;
      if (opts.failWith) throw opts.failWith;
      if (opts.hang) await new Promise<never>((_, reject) => (release = reject));
    },
  };
}

function streamingClient(result: ReturnType<typeof fakeParts> | Error | Promise<unknown>) {
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

async function drain(chunks: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

const req = () => ({ ...request, messages: [...request.messages] });

describe('OllamaProvider.stream', () => {
  test('asks Ollama for a stream and maps the parts to chunks', async () => {
    const parts = fakeParts([part('Hel'), part('lo'), donePart()]);
    const client = streamingClient(parts);
    const provider = new OllamaProvider({ client: client as never });

    const chunks = await drain(provider.stream(req()));

    expect(client.calls).toEqual([
      {
        model: 'llama3.2',
        stream: true,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Hi' },
        ],
      },
    ]);
    expect(chunks).toEqual([
      { type: 'text.delta', text: 'Hel' },
      { type: 'text.delta', text: 'lo' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 3 } },
    ]);
  });

  test('a tool call sent before the done part still finishes with tool_calls', async () => {
    const parts = fakeParts([toolPart('get_current_time', { timezone: 'UTC' }), donePart()]);
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });

    const response = await collectStream(provider.stream(req()));

    expect(response.finishReason).toBe('tool_calls');
    expect(response.message.content).toBeNull();
    expect(response.message.tool_calls).toMatchObject([
      { function: { name: 'get_current_time', arguments: '{"timezone":"UTC"}' } },
    ]);
  });

  test('closes the connection after a normal end too', async () => {
    const parts = fakeParts([part('hi'), donePart()]);
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });

    await drain(provider.stream(req()));

    expect(parts.state.aborts).toBe(1);
  });

  test('closes the connection when the consumer breaks out early', async () => {
    const parts = fakeParts([part('a'), part('b'), donePart()]);
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });

    for await (const _chunk of provider.stream(req())) break;

    expect(parts.state.aborts).toBe(1);
  });

  test('aborting mid-stream ends the loop with signal.reason and closes the connection', async () => {
    const parts = fakeParts([part('a')], { hang: true });
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });
    const controller = new AbortController();
    const reason = new Error('stop');
    const seen: ChatChunk[] = [];

    const read = async () => {
      for await (const chunk of provider.stream(req(), { signal: controller.signal })) {
        seen.push(chunk);
        // Let the generator move on to wait for the next part before aborting.
        setTimeout(() => controller.abort(reason), 10);
      }
    };

    await expect(read()).rejects.toBe(reason);
    expect(seen).toEqual([{ type: 'text.delta', text: 'a' }]);
    expect(parts.state.aborts).toBeGreaterThanOrEqual(1);
  });

  test('an already-aborted signal fails without calling Ollama', async () => {
    const client = streamingClient(fakeParts([]));
    const provider = new OllamaProvider({ client: client as never });

    await expect(drain(provider.stream(req(), { signal: AbortSignal.abort() }))).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });

  test('aborting while waiting for the response headers rejects with signal.reason', async () => {
    const provider = new OllamaProvider({
      client: streamingClient(new Promise(() => {})) as never,
    });
    const controller = new AbortController();
    const reason = new Error('stop');

    const pending = drain(provider.stream(req(), { signal: controller.signal }));
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  test('closes a response that arrives after an abort won the race for the headers', async () => {
    const late = fakeParts([part('late'), donePart()]);
    let answer!: (value: typeof late) => void;
    const provider = new OllamaProvider({
      client: streamingClient(new Promise((resolve) => (answer = resolve))) as never,
    });
    const controller = new AbortController();

    const pending = drain(provider.stream(req(), { signal: controller.signal }));
    const reason = new Error('stop');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(late.state.aborts).toBe(0);

    answer(late);
    await new Promise((resolve) => setImmediate(resolve));

    expect(late.state.aborts).toBe(1);
  });

  test('leaves no abort listener on a reused signal after end, break, error or abort', async () => {
    const controller = new AbortController();
    const { signal } = controller;
    const ending = () => fakeParts([part('a'), donePart()]);

    for (let i = 0; i < 10; i++) {
      await drain(
        new OllamaProvider({ client: streamingClient(ending()) as never }).stream(req(), {
          signal,
        }),
      );
      for await (const _ of new OllamaProvider({
        client: streamingClient(ending()) as never,
      }).stream(req(), { signal }))
        break;
      await drain(
        new OllamaProvider({ client: streamingClient(new Error('boom')) as never }).stream(req(), {
          signal,
        }),
      ).catch(() => {});
      await drain(
        new OllamaProvider({
          client: streamingClient(fakeParts([], { failWith: new Error('cut') })) as never,
        }).stream(req(), { signal }),
      ).catch(() => {});
    }

    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

  test('a connection failure is a retryable ProviderError that keeps the cause', async () => {
    const original = new TypeError('fetch failed');
    const provider = new OllamaProvider({ client: streamingClient(original) as never });

    const err = await drain(provider.stream(req())).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      message: 'Could not reach Ollama: fetch failed',
      provider: 'ollama',
      retryable: true,
      cause: original,
    });
  });

  test('404 tells the user to pull the model', async () => {
    const notFound = Object.assign(new Error('model not found'), { status_code: 404 });
    const provider = new OllamaProvider({ client: streamingClient(notFound) as never });

    const err = await drain(provider.stream(req())).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('ollama pull llama3.2');
    expect(err.retryable).toBe(false);
  });

  test('a failure in the middle of the stream is a ProviderError and the connection is closed', async () => {
    const cut = new Error('terminated');
    const parts = fakeParts([part('a')], { failWith: cut });
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });
    const seen: ChatChunk[] = [];

    const err = await (async () => {
      for await (const chunk of provider.stream(req())) seen.push(chunk);
    })().catch((e) => e);

    expect(seen).toEqual([{ type: 'text.delta', text: 'a' }]);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ retryable: true, cause: cut });
    expect(parts.state.aborts).toBe(1);
  });

  test('a stream that ends without a done part is a retryable ProviderError', async () => {
    const parts = fakeParts([part('a'), part('b')]);
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });

    const err = await drain(provider.stream(req())).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      message: 'Ollama stream ended before the final part',
      retryable: true,
    });
  });

  test('an unknown done_reason keeps its own message instead of looking like a connection failure', async () => {
    const parts = fakeParts([donePart({ done_reason: 'weird' })]);
    const provider = new OllamaProvider({ client: streamingClient(parts) as never });

    const err = await drain(provider.stream(req())).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Unexpected Ollama done_reason: weird');
    expect(err.retryable).toBe(false);
    expect(parts.state.aborts).toBe(1);
  });

  test('an invalid history fails as a non-retryable ProviderError without calling Ollama', async () => {
    const client = streamingClient(fakeParts([]));
    const provider = new OllamaProvider({ client: client as never });

    const err = await drain(
      provider.stream({
        model: 'llama3.2',
        messages: [{ role: 'tool', tool_call_id: 'x', content: 'r' }],
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(client.calls).toEqual([]);
  });
});

describe('OllamaProvider.stream over HTTP', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  /** An Ollama-like NDJSON endpoint. `closedEarly` flips when the client hangs up before `res.end()`. */
  async function serve(opts: {
    headersDelayMs?: number;
    lines: string[];
    lineDelayMs?: number;
    hangAtEnd?: boolean;
  }) {
    const state = { closedEarly: false, closed: false };
    server = createServer((_req, res) => {
      res.on('close', () => {
        state.closed = true;
        state.closedEarly = !res.writableEnded;
      });
      const start = () => {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        let i = 0;
        const next = () => {
          if (res.destroyed) return;
          const last = i === opts.lines.length - 1;
          res.write(`${opts.lines[i++]}\n`);
          // End in the same tick as the last line: a client that hangs up after `done` is then not "early".
          if (last && !opts.hangAtEnd) res.end();
          else if (!last) setTimeout(next, opts.lineDelayMs ?? 5);
        };
        next();
      };
      if (opts.headersDelayMs) setTimeout(start, opts.headersDelayMs);
      else start();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { state, provider: new OllamaProvider({ baseUrl: `http://127.0.0.1:${port}` }) };
  }

  const line = (p: OllamaResponse) => JSON.stringify(p);
  const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Polls until `done()`; the server learns of a hang-up a moment after the client does it. */
  async function until(done: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!done() && performance.now() < deadline) await settle(10);
  }

  test('streams a real NDJSON body to chunks', async () => {
    const { provider, state } = await serve({
      lines: [line(part('Hel')), line(part('lo')), line(donePart())],
    });

    const response = await collectStream(provider.stream(req()));

    expect(response).toEqual({
      message: { role: 'assistant', content: 'Hello' },
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 3 },
    });
    await settle();
    expect(state.closedEarly).toBe(false);
  });

  test('break closes the HTTP request', async () => {
    const { provider, state } = await serve({
      lines: [line(part('a')), line(part('b')), line(part('c')), line(donePart())],
      lineDelayMs: 30,
    });

    for await (const _chunk of provider.stream(req())) break;
    await until(() => state.closed);

    expect(state.closedEarly).toBe(true);
  });

  test('abort mid-stream ends the loop with signal.reason and closes the HTTP request', async () => {
    const { provider, state } = await serve({ lines: [line(part('a'))], hangAtEnd: true });
    const controller = new AbortController();
    const reason = new Error('stop');

    const read = async () => {
      for await (const _chunk of provider.stream(req(), { signal: controller.signal })) {
        controller.abort(reason);
      }
    };

    await expect(read()).rejects.toBe(reason);
    await until(() => state.closed);
    expect(state.closedEarly).toBe(true);
  });

  test('abort while the server is still holding back the headers is prompt and closes the request', async () => {
    // The response never ends on its own, so only the client hanging up can close it.
    const { provider, state } = await serve({
      headersDelayMs: 400,
      lines: [line(part('a'))],
      hangAtEnd: true,
    });
    const controller = new AbortController();
    const reason = new Error('stop');
    setTimeout(() => controller.abort(reason), 50);
    const start = performance.now();

    await expect(drain(provider.stream(req(), { signal: controller.signal }))).rejects.toBe(reason);
    expect(performance.now() - start).toBeLessThan(300);

    // The request is closed once the late headers arrive (the client can't cancel it before that).
    await until(() => state.closed);
    expect(state.closed).toBe(true);
    expect(state.closedEarly).toBe(true);
  });

  test('a server that cuts the body short is a retryable ProviderError', async () => {
    const { provider } = await serve({ lines: [line(part('a'))] });

    const err = await drain(provider.stream(req())).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
  });

  test('Ollama being down is a retryable ProviderError', async () => {
    const down = new OllamaProvider({ baseUrl: 'http://127.0.0.1:1' });

    const err = await drain(down.stream(req())).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ retryable: true });
    expect(err.message).toContain('Could not reach Ollama');
  });
});
