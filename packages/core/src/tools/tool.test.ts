import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { defineTool, type Tool, type ToolContext, toToolDefinition } from './tool.ts';

test('execute input type is inferred from the input schema', () => {
  defineTool({
    name: 'add',
    description: 'adds two numbers',
    input: z.object({ a: z.number(), b: z.number().optional() }),
    async execute(input) {
      expectTypeOf(input).toEqualTypeOf<{ a: number; b?: number | undefined }>();
      return input.a;
    },
  });
});

test('execute ctx is ToolContext and output type flows into the returned Tool', () => {
  const tool = defineTool({
    name: 'echo',
    description: 'echoes text',
    input: z.object({ text: z.string() }),
    async execute(input, ctx) {
      expectTypeOf(ctx).toEqualTypeOf<ToolContext>();
      return input.text.length;
    },
  });

  expectTypeOf(tool).toEqualTypeOf<Tool<{ text: string }, number>>();
});

test('schema transforms are reflected in the execute input type', () => {
  defineTool({
    name: 'parse',
    description: 'parses a numeric string',
    input: z.object({ n: z.string().transform(Number) }),
    async execute(input) {
      expectTypeOf(input.n).toBeNumber();
      return null;
    },
  });
});

test('execute with a mismatched input annotation is rejected', () => {
  const bad = {
    name: 'bad',
    description: 'wrong annotation',
    input: z.object({ a: z.number() }),
    async execute(input: { a: string }) {
      return input.a;
    },
  };

  // @ts-expect-error input.a is number, not string
  defineTool(bad);
});

test('the returned value is the same object', () => {
  const def = {
    name: 'noop',
    description: 'does nothing',
    input: z.object({}),
    async execute() {
      return 1;
    },
  };
  expect(defineTool(def)).toBe(def);
});

test('toToolDefinition maps name, description and the input schema to JSON Schema', () => {
  const tool = defineTool({
    name: 'add',
    description: 'adds two numbers',
    input: z.object({ a: z.number(), b: z.number().optional() }),
    async execute(input) {
      return input.a;
    },
  });

  expect(toToolDefinition(tool)).toMatchObject({
    type: 'function',
    function: {
      name: 'add',
      description: 'adds two numbers',
      parameters: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a'],
      },
    },
  });
});

test('toToolDefinition excludes the $schema property', () => {
  const tool = defineTool({
    name: 'add',
    description: 'adds two numbers',
    input: z.object({ a: z.number(), b: z.number().optional() }),
    async execute(input) {
      return input.a;
    },
  });

  expect(toToolDefinition(tool).function.parameters).not.toHaveProperty('$schema');
});

test('toToolDefinition describes the pre-transform shape of the input', () => {
  const tool = defineTool({
    name: 'parse',
    description: 'parses a numeric string',
    input: z.object({ n: z.string().transform(Number) }),
    async execute(input) {
      return input.n;
    },
  });

  expect(toToolDefinition(tool).function.parameters).toMatchObject({
    properties: { n: { type: 'string' } },
  });
});

test('toToolDefinition throws on schemas JSON Schema cannot represent', () => {
  const tool = defineTool({
    name: 'when',
    description: 'takes a date',
    input: z.object({ at: z.date() }),
    async execute() {
      return null;
    },
  });

  expect(() => toToolDefinition(tool)).toThrow();
});

test('toToolDefinition carries .describe() text into property descriptions', () => {
  const tool = defineTool({
    name: 'weather',
    description: 'gets the weather',
    input: z.object({
      city: z.string().describe('City name'),
      unit: z.enum(['c', 'f']).optional().describe('Temperature unit'),
      where: z.object({ x: z.number().describe('Longitude') }).describe('Coordinates'),
    }),
    async execute() {
      return null;
    },
  });

  expect(toToolDefinition(tool).function.parameters).toMatchObject({
    properties: {
      city: { description: 'City name' },
      unit: { description: 'Temperature unit' },
      where: { description: 'Coordinates', properties: { x: { description: 'Longitude' } } },
    },
  });
});
