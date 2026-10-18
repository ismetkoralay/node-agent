import { expect, test } from 'vitest';
import { z } from 'zod';
import type { ToolCall } from '../types/index.ts';
import { ToolRegistry } from './registry.ts';
import { defineTool, type Tool, type ToolContext } from './tool.ts';

test('registry stores tools', () => {
  const tools = getDummyTools();
  const registry = new ToolRegistry(tools);
  const definitions = registry.definitions();
  expect(definitions.length).toBe(tools.length);
  for (const tool of tools) {
    const definition = definitions.find((d) => d.function.name === tool.name);
    expect(definition).toBeDefined();
    expect(definition?.function.description).toBe(tool.description);
  }
});

test('registry throws error for duplicate tool names', () => {
  const tools = getDummyTools();
  tools.push(
    defineTool({
      name: 'tool1',
      description: 'duplicate tool',
      input: z.object({}),
      async execute() {
        return null;
      },
    }),
  );
  expect(() => new ToolRegistry(tools)).toThrow(/Tool with name "tool1" is already registered/);
  expect(() => new ToolRegistry(tools)).toThrow(
    expect.objectContaining({ code: 'tool_already_registered' }),
  );
});

test('execute returns the output and a duration for a successful call', async () => {
  const registry = new ToolRegistry([addTool()]);

  const result = await registry.execute(callOf('add', { a: 5, b: 3 }), makeCtx());

  expect(result).toMatchObject({ ok: true, output: 8 });
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test('execute passes the parsed input object to the tool, not the raw arguments string', async () => {
  const received: unknown[] = [];
  const registry = new ToolRegistry([
    defineTool({
      name: 'greet',
      description: 'greets someone',
      input: z.object({ name: z.string(), greeting: z.string().default('hello') }),
      async execute(input) {
        received.push(input);
        return `${input.greeting} ${input.name}`;
      },
    }),
  ]);

  const result = await registry.execute(callOf('greet', { name: 'Ada' }), makeCtx());

  expect(received).toEqual([{ name: 'Ada', greeting: 'hello' }]);
  expect(result).toMatchObject({ ok: true, output: 'hello Ada' });
});

test('execute returns ok:false listing the available tools for an unknown tool', async () => {
  const registry = new ToolRegistry(getDummyTools());

  const result = await registry.execute(callOf('nope', {}), makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('"nope"');
  expect(result.error).toContain('tool1');
  expect(result.error).toContain('tool2');
  expect(result.error).toContain('tool3');
});

test('execute returns ok:false for arguments that are not valid JSON', async () => {
  const registry = new ToolRegistry([addTool()]);
  const call: ToolCall = {
    id: 'call-1',
    type: 'function',
    function: { name: 'add', arguments: '{"a": 5, "b":' },
  };

  const result = await registry.execute(call, makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('"add"');
  expect(result.error).toMatch(/JSON/);
});

test('execute returns ok:false naming the offending field for a schema violation', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'weather',
      description: 'gets the weather',
      input: z.object({ city: z.string() }),
      async execute() {
        return 'sunny';
      },
    }),
  ]);

  const result = await registry.execute(callOf('weather', {}), makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('"weather"');
  expect(result.error).toContain('city');
});

test('execute names every offending field when several are invalid', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'resize',
      description: 'resizes an image',
      input: z.object({ width: z.int(), height: z.int() }),
      async execute() {
        return 'ok';
      },
    }),
  ]);

  const result = await registry.execute(callOf('resize', { width: 'wide' }), makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('width');
  expect(result.error).toContain('height');
});

test('execute returns ok:false when a schema transform throws', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'parse',
      description: 'schema whose transform throws',
      input: z.object({}).transform(() => {
        throw new Error('transform exploded');
      }),
      async execute() {
        return 'unreachable';
      },
    }),
  ]);

  const result = await registry.execute(callOf('parse', {}), makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('"parse"');
  expect(result.error).toContain('transform exploded');
});

test('execute validates against async refinements without rejecting', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'lookup',
      description: 'schema with an async refinement',
      input: z.object({ id: z.string() }).refine(async (v) => v.id === 'known', 'unknown id'),
      async execute() {
        return 'found';
      },
    }),
  ]);

  const bad = await registry.execute(callOf('lookup', { id: 'other' }), makeCtx());
  const good = await registry.execute(callOf('lookup', { id: 'known' }), makeCtx());

  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error).toContain('unknown id');
  expect(good).toMatchObject({ ok: true, output: 'found' });
});

test('execute does not run the tool when validation fails', async () => {
  let runs = 0;
  const registry = new ToolRegistry([
    defineTool({
      name: 'count',
      description: 'counts runs',
      input: z.object({ n: z.number() }),
      async execute() {
        runs++;
        return runs;
      },
    }),
  ]);

  await registry.execute(callOf('count', { n: 'not a number' }), makeCtx());

  expect(runs).toBe(0);
});

test('execute returns ok:false with the message when the tool throws an Error', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'boom',
      description: 'always fails',
      input: z.object({}),
      async execute() {
        throw new Error('disk is full');
      },
    }),
  ]);

  const result = await registry.execute(callOf('boom', {}), makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('disk is full');
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test('execute returns ok:false with a string error when the tool throws a non-Error', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'boom',
      description: 'throws a string',
      input: z.object({}),
      async execute() {
        throw 'plain string failure';
      },
    }),
  ]);

  const result = await registry.execute(callOf('boom', {}), makeCtx());

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.error).toBe('string');
  expect(result.error).toContain('plain string failure');
});

test('execute returns ok:false and does not run the tool when the signal is already aborted', async () => {
  let runs = 0;
  const registry = new ToolRegistry([
    defineTool({
      name: 'slow',
      description: 'should never run',
      input: z.object({}),
      async execute() {
        runs++;
        return 'done';
      },
    }),
  ]);
  const controller = new AbortController();
  controller.abort();

  const result = await registry.execute(callOf('slow', {}), makeCtx(controller.signal));

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('"slow"');
  expect(result.error).toMatch(/abort/i);
  expect(runs).toBe(0);
});

test('execute includes a custom abort reason in the error', async () => {
  const registry = new ToolRegistry([addTool()]);
  const controller = new AbortController();
  controller.abort(new Error('timed out after 30s'));

  const result = await registry.execute(callOf('add', { a: 1, b: 2 }), makeCtx(controller.signal));

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('timed out after 30s');
});

test('execute checks the signal before looking up the tool', async () => {
  const registry = new ToolRegistry([addTool()]);
  const controller = new AbortController();
  controller.abort();

  const result = await registry.execute(callOf('missing', {}), makeCtx(controller.signal));

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatch(/abort/i);
});

test('execute treats empty arguments as an empty object', async () => {
  const registry = new ToolRegistry([
    defineTool({
      name: 'ping',
      description: 'takes no arguments',
      input: z.object({}),
      async execute() {
        return 'pong';
      },
    }),
  ]);
  const call: ToolCall = {
    id: 'call-1',
    type: 'function',
    function: { name: 'ping', arguments: '' },
  };

  const result = await registry.execute(call, makeCtx());

  expect(result).toMatchObject({ ok: true, output: 'pong' });
});

test('execute never rejects for any of the failure scenarios', async () => {
  const controller = new AbortController();
  controller.abort();
  const registry = new ToolRegistry([addTool()]);
  const bad: ToolCall = {
    id: 'call-1',
    type: 'function',
    function: { name: 'add', arguments: 'not json' },
  };

  await expect(registry.execute(callOf('missing', {}), makeCtx())).resolves.toMatchObject({
    ok: false,
  });
  await expect(registry.execute(bad, makeCtx())).resolves.toMatchObject({ ok: false });
  await expect(registry.execute(callOf('add', {}), makeCtx())).resolves.toMatchObject({
    ok: false,
  });
  await expect(
    registry.execute(callOf('add', { a: 1, b: 2 }), makeCtx(controller.signal)),
  ).resolves.toMatchObject({ ok: false });
});

function addTool(): Tool {
  return defineTool({
    name: 'add',
    description: 'adds two numbers',
    input: z.object({ a: z.number(), b: z.number() }),
    async execute(input) {
      return input.a + input.b;
    },
  });
}

function callOf(name: string, args: unknown): ToolCall {
  return {
    id: 'call-1',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return {
    signal,
    conversationId: 'conv-1',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

function getDummyTools(): Tool[] {
  return [
    defineTool({
      name: 'tool1',
      description: 'dummy tool 1',
      input: z.object({}),
      async execute() {
        return null;
      },
    }),
    defineTool({
      name: 'tool2',
      description: 'dummy tool 2',
      input: z.object({}),
      async execute() {
        return null;
      },
    }),
    defineTool({
      name: 'tool3',
      description: 'dummy tool 3',
      input: z.object({}),
      async execute() {
        return null;
      },
    }),
  ];
}
