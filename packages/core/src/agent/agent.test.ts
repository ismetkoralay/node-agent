import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { ConversationNotFoundError } from '../errors/conversation_not_found_error.ts';
import { ProviderError } from '../errors/provider_error.ts';
import { InMemoryChatStore } from '../memory/in_memory_chat_store.ts';
import { FakeProvider, type FakeProviderStep } from '../testing/fake_provider.ts';
import { textResponse, toolCallResponse } from '../testing/responses.ts';
import { defineTool } from '../tools/tool.ts';
import type { ChatResponse } from '../types/index.ts';
import { createAgent } from './agent.ts';

const MODEL = 'test-model';

function echoTool() {
  return defineTool({
    name: 'echo',
    description: 'Echoes the text back',
    input: z.object({ text: z.string() }),
    async execute({ text }) {
      return text;
    },
  });
}

function sleepTool(name: string, ms: number) {
  return defineTool({
    name,
    description: `Waits ${ms} ms`,
    input: z.object({}),
    async execute() {
      await sleep(ms);
      return name;
    },
  });
}

async function setup(script: FakeProviderStep[], options: { delayMs?: number } = {}) {
  const store = new InMemoryChatStore();
  const { id } = await store.createConversation();
  const provider = new FakeProvider(script, options);
  return { store, id, provider };
}

test('answers without tools in a single provider call', async () => {
  const { store, id, provider } = await setup([textResponse('hello')]);
  const agent = createAgent({ provider, model: MODEL, store });

  const result = await agent.run({ conversationId: id, input: 'hi' });

  expect(result.finishReason).toBe('stop');
  expect(result.steps).toBe(1);
  expect(result.message).toEqual({ role: 'assistant', content: 'hello' });
  expect(provider.requests).toHaveLength(1);
  expect(result.newMessages).toEqual([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  await expect(store.getMessages(id)).resolves.toEqual(result.newMessages);
});

test('runs a tool and sends its result to the model', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'echo', args: { text: 'ping' } }]),
    textResponse('done'),
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  const result = await agent.run({ conversationId: id, input: 'say ping' });

  expect(result.steps).toBe(2);
  expect(result.finishReason).toBe('stop');
  const stored = await store.getMessages(id);
  expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  expect(stored[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'ping' });
  expect(provider.requests[1]?.messages.at(-1)).toEqual({
    role: 'tool',
    tool_call_id: 'call_1',
    content: 'ping',
  });
  expect(result.newMessages).toEqual(stored);
});

test('runs the tool calls of one turn in parallel', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([
      { name: 'a', args: {} },
      { name: 'b', args: {} },
    ]),
    textResponse('done'),
  ]);
  const agent = createAgent({
    provider,
    model: MODEL,
    store,
    tools: [sleepTool('a', 100), sleepTool('b', 100)],
  });

  const start = performance.now();
  await agent.run({ conversationId: id, input: 'go' });
  const elapsed = performance.now() - start;

  expect(elapsed).toBeGreaterThanOrEqual(90);
  expect(elapsed).toBeLessThan(180);
});

test('adds tool messages in call order, not completion order', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([
      { name: 'slow', args: {} },
      { name: 'fast', args: {} },
    ]),
    textResponse('done'),
  ]);
  const agent = createAgent({
    provider,
    model: MODEL,
    store,
    tools: [sleepTool('slow', 80), sleepTool('fast', 5)],
  });

  await agent.run({ conversationId: id, input: 'go' });

  const stored = await store.getMessages(id);
  expect(stored.slice(2, 4)).toEqual([
    { role: 'tool', tool_call_id: 'call_1', content: 'slow' },
    { role: 'tool', tool_call_id: 'call_2', content: 'fast' },
  ]);
});

test('feeds an unknown tool error back to the model instead of crashing', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'nope', args: {} }]),
    (req) => {
      const last = req.messages.at(-1);
      const sawError = last?.role === 'tool' && /not registered/.test(last.content);
      return textResponse(sawError ? 'recovered' : 'did not see the error');
    },
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  const result = await agent.run({ conversationId: id, input: 'go' });

  expect(result.message.content).toBe('recovered');
  expect(result.finishReason).toBe('stop');
});

test('feeds invalid tool arguments back to the model instead of crashing', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'echo', args: { text: 42 } }]),
    (req) => {
      const last = req.messages.at(-1);
      const sawError = last?.role === 'tool' && /Invalid input for tool "echo"/.test(last.content);
      return textResponse(sawError ? 'recovered' : 'did not see the error');
    },
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  const result = await agent.run({ conversationId: id, input: 'go' });

  expect(result.message.content).toBe('recovered');
});

test('stops at maxSteps and still answers every tool call', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'echo', args: { text: '1' } }]),
    toolCallResponse([{ name: 'echo', args: { text: '2' } }]),
    toolCallResponse([{ name: 'echo', args: { text: '3' } }]),
  ]);
  const agent = createAgent({
    provider,
    model: MODEL,
    store,
    tools: [echoTool()],
    maxSteps: 3,
  });

  const result = await agent.run({ conversationId: id, input: 'loop' });

  expect(result.finishReason).toBe('max_steps');
  expect(result.steps).toBe(3);
  expect(provider.requests).toHaveLength(3);
  const stored = await store.getMessages(id);
  expect(stored.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '3' });
  expect(result.message.tool_calls).toHaveLength(1);
  const callIds = stored.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : []));
  const answered = stored.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : []));
  expect(answered).toHaveLength(callIds.length);
});

test('defaults maxSteps to 8', async () => {
  const script = Array.from({ length: 10 }, () =>
    toolCallResponse([{ name: 'echo', args: { text: 'x' } }]),
  );
  const { store, id, provider } = await setup(script);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  const result = await agent.run({ conversationId: id, input: 'loop' });

  expect(result.steps).toBe(8);
  expect(result.finishReason).toBe('max_steps');
});

test('sends the history of earlier runs to the model', async () => {
  const { store, id, provider } = await setup([textResponse('one'), textResponse('two')]);
  const agent = createAgent({ provider, model: MODEL, store });

  await agent.run({ conversationId: id, input: 'first' });
  await agent.run({ conversationId: id, input: 'second' });

  expect(provider.requests[1]?.messages).toEqual([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'one' },
    { role: 'user', content: 'second' },
  ]);
});

test('prepends the system prompt to every request but never stores it', async () => {
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'echo', args: { text: 'x' } }]),
    textResponse('done'),
  ]);
  const agent = createAgent({
    provider,
    model: MODEL,
    store,
    tools: [echoTool()],
    systemPrompt: 'be brief',
  });

  const result = await agent.run({ conversationId: id, input: 'go' });

  for (const request of provider.requests) {
    expect(request.messages[0]).toEqual({ role: 'system', content: 'be brief' });
  }
  expect((await store.getMessages(id)).some((m) => m.role === 'system')).toBe(false);
  expect(result.newMessages.some((m) => m.role === 'system')).toBe(false);
});

test('sends the model name and tool definitions', async () => {
  const { store, id, provider } = await setup([textResponse('hi')]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  await agent.run({ conversationId: id, input: 'hi' });

  const request = provider.requests[0];
  expect(request?.model).toBe(MODEL);
  expect(request?.tools?.map((t) => t.function.name)).toEqual(['echo']);
});

test('omits the tools field when the agent has no tools', async () => {
  const { store, id, provider } = await setup([textResponse('hi')]);
  const agent = createAgent({ provider, model: MODEL, store });

  await agent.run({ conversationId: id, input: 'hi' });

  expect(provider.requests[0]).not.toHaveProperty('tools');
});

test('sums token usage over all steps', async () => {
  const first: ChatResponse = {
    ...toolCallResponse([{ name: 'echo', args: { text: 'x' } }]),
    usage: { promptTokens: 10, completionTokens: 3 },
  };
  const second: ChatResponse = {
    ...textResponse('done'),
    usage: { promptTokens: 20, completionTokens: 5 },
  };
  const { store, id, provider } = await setup([first, second]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  const result = await agent.run({ conversationId: id, input: 'go' });

  expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 8 });
});

test('reports zero usage when the provider gives none', async () => {
  const { store, id, provider } = await setup([textResponse('hi')]);
  const agent = createAgent({ provider, model: MODEL, store });

  const result = await agent.run({ conversationId: id, input: 'hi' });

  expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
});

test('reports a truncated answer as finishReason length', async () => {
  const truncated: ChatResponse = { ...textResponse('cut off'), finishReason: 'length' };
  const { store, id, provider } = await setup([truncated]);
  const agent = createAgent({ provider, model: MODEL, store });

  const result = await agent.run({ conversationId: id, input: 'hi' });

  expect(result.finishReason).toBe('length');
  await expect(store.getMessages(id)).resolves.toHaveLength(2);
});

test('rejects with the provider error and stores nothing', async () => {
  const boom = new ProviderError('backend down', { provider: 'fake', retryable: true });
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'echo', args: { text: 'x' } }]),
    boom,
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()] });

  await expect(agent.run({ conversationId: id, input: 'go' })).rejects.toBe(boom);

  await expect(store.getMessages(id)).resolves.toEqual([]);
});

test('rejects for an unknown conversation without calling the provider', async () => {
  const { store, provider } = await setup([textResponse('hi')]);
  const agent = createAgent({ provider, model: MODEL, store });

  await expect(agent.run({ conversationId: 'missing', input: 'hi' })).rejects.toBeInstanceOf(
    ConversationNotFoundError,
  );
  expect(provider.requests).toHaveLength(0);
});

test('rejects and stores nothing when aborted during a provider call', async () => {
  const { store, id, provider } = await setup([textResponse('late')], { delayMs: 200 });
  const agent = createAgent({ provider, model: MODEL, store });
  const controller = new AbortController();
  const reason = new Error('user cancelled');
  setTimeout(() => controller.abort(reason), 20);

  await expect(
    agent.run({ conversationId: id, input: 'hi', signal: controller.signal }),
  ).rejects.toBe(reason);

  await expect(store.getMessages(id)).resolves.toEqual([]);
});

test('rejects without calling the provider when already aborted', async () => {
  const { store, id, provider } = await setup([textResponse('hi')]);
  const agent = createAgent({ provider, model: MODEL, store });
  const controller = new AbortController();
  controller.abort(new Error('too late'));

  await expect(
    agent.run({ conversationId: id, input: 'hi', signal: controller.signal }),
  ).rejects.toThrow('too late');

  expect(provider.requests).toHaveLength(0);
});

test('does not call the model again when aborted while a tool runs', async () => {
  const controller = new AbortController();
  const reason = new Error('user cancelled');
  const abortingTool = defineTool({
    name: 'slow',
    description: 'Gets aborted mid-run',
    input: z.object({}),
    async execute(_input, ctx) {
      controller.abort(reason);
      await sleep(10);
      ctx.signal.throwIfAborted();
      return 'unreachable';
    },
  });
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'slow', args: {} }]),
    textResponse('should never be requested'),
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [abortingTool] });

  await expect(
    agent.run({ conversationId: id, input: 'go', signal: controller.signal }),
  ).rejects.toBe(reason);

  expect(provider.requests).toHaveLength(1);
  await expect(store.getMessages(id)).resolves.toEqual([]);
});

test('rejects and stores nothing when aborted while a tool runs on the last step', async () => {
  const controller = new AbortController();
  const reason = new Error('user cancelled');
  const abortingTool = defineTool({
    name: 'slow',
    description: 'Gets aborted mid-run',
    input: z.object({}),
    async execute() {
      controller.abort(reason);
      return 'done anyway';
    },
  });
  const { store, id, provider } = await setup([toolCallResponse([{ name: 'slow', args: {} }])]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [abortingTool], maxSteps: 1 });

  await expect(
    agent.run({ conversationId: id, input: 'go', signal: controller.signal }),
  ).rejects.toBe(reason);

  await expect(store.getMessages(id)).resolves.toEqual([]);
});

test('gives tools the conversation id, a live signal and the logger', async () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let seen: { conversationId: string; aborted: boolean; logger: unknown } | undefined;
  const probe = defineTool({
    name: 'probe',
    description: 'Captures its context',
    input: z.object({}),
    async execute(_input, ctx) {
      seen = {
        conversationId: ctx.conversationId,
        aborted: ctx.signal.aborted,
        logger: ctx.logger,
      };
      return 'ok';
    },
  });
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'probe', args: {} }]),
    textResponse('done'),
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [probe], logger });

  await agent.run({ conversationId: id, input: 'go' });

  expect(seen).toEqual({ conversationId: id, aborted: false, logger });
});

test('logs every step with its step number', async () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { store, id, provider } = await setup([
    toolCallResponse([{ name: 'echo', args: { text: 'x' } }]),
    textResponse('done'),
  ]);
  const agent = createAgent({ provider, model: MODEL, store, tools: [echoTool()], logger });

  await agent.run({ conversationId: id, input: 'go' });

  const metas = logger.debug.mock.calls.map(([, meta]) => meta as Record<string, unknown>);
  expect(logger.debug).toHaveBeenCalledWith('agent step', expect.objectContaining({ step: 1 }));
  expect(logger.debug).toHaveBeenCalledWith('agent step', expect.objectContaining({ step: 2 }));
  expect(logger.debug).toHaveBeenCalledWith(
    'tools executed',
    expect.objectContaining({
      step: 1,
      results: [
        expect.objectContaining({
          id: expect.any(String),
          name: 'echo',
          ok: true,
          durationMs: expect.any(Number),
        }),
      ],
    }),
  );
  expect(metas.every((meta) => typeof meta.step === 'number')).toBe(true);
});

test.each([0, -1, 1.5])('fails at creation when maxSteps is %s', async (maxSteps) => {
  const { store, provider } = await setup([]);

  expect(() => createAgent({ provider, model: MODEL, store, maxSteps })).toThrow(RangeError);
});

test('fails at creation when two tools share a name', async () => {
  const { store, provider } = await setup([]);

  expect(() =>
    createAgent({ provider, model: MODEL, store, tools: [echoTool(), echoTool()] }),
  ).toThrow(/already registered/);
});
