import { AgentError, type ToolCall, ToolRegistry } from '@node-agent/core';
import { expect, test } from 'vitest';
import { calculatorTool } from './calculator.ts';
import { makeCtx } from './test_context.ts';

const run = (expression: string) => calculatorTool.execute({ expression }, makeCtx());

test('calculator throws for empty expression', async () => {
  await expect(run('')).rejects.toThrow(
    new AgentError(`Invalid expression: "". E.g. "12 * 34"`, 'invalid_expression_input'),
  );
});

test('calculator wraps a mathjs syntax error once and keeps it as cause', async () => {
  const err = await run('1 1 1').catch((e: unknown) => e);

  expect(err).toBeInstanceOf(AgentError);
  expect((err as AgentError).code).toBe('invalid_expression_execution');
  expect((err as AgentError).message).toBe(
    'Could not evaluate "1 1 1": Unexpected part "1" (char 3)',
  );
  expect((err as AgentError).cause).toBeInstanceOf(Error);
});

test('calculator evaluates the large multiplication', async () => {
  await expect(run('12345 * 6789')).resolves.toEqual({
    expression: '12345 * 6789',
    result: '83810205',
  });
});

test('calculator evaluates valid multiplication expression', async () => {
  await expect(run('1 * 2')).resolves.toEqual({ expression: '1 * 2', result: '2' });
});

test('calculator removes floating point noise', async () => {
  await expect(run('0.1000 + 0.2')).resolves.toEqual({ expression: '0.1000 + 0.2', result: '0.3' });
  await expect(run('sqrt(2) ^ 2')).resolves.toEqual({ expression: 'sqrt(2) ^ 2', result: '2' });
});

test('calculator returns Infinity for division by zero', async () => {
  await expect(run('1/0')).resolves.toEqual({ expression: '1/0', result: 'Infinity' });
});

test('calculator formats complex results', async () => {
  await expect(run('sqrt(-4)')).resolves.toEqual({ expression: 'sqrt(-4)', result: '2i' });
});

test('calculator evaluates unit conversions', async () => {
  await expect(run('2 inch to cm')).resolves.toEqual({
    expression: '2 inch to cm',
    result: '5.08 cm',
  });
});

test('calculator throws for an os command', async () => {
  await expect(run('process.exit()')).rejects.toThrow(
    new AgentError(
      'Could not evaluate "process.exit()": Undefined symbol process',
      'invalid_expression_execution',
    ),
  );
});

test.each([
  ['a function definition', 'f(x) = x^2'],
  ['multiple statements', '1; 2'],
])('calculator rejects %s with a single, unwrapped error', async (_name, expression) => {
  const err = await run(expression).catch((e: unknown) => e);

  expect(err).toBeInstanceOf(AgentError);
  expect((err as AgentError).code).toBe('invalid_expression_kind');
  expect((err as AgentError).message).toBe(
    'Expression must produce a single value, e.g. "2 * (3 + 4)".',
  );
});

test('calculator cannot register units through the shared mathjs instance', async () => {
  await expect(run('createUnit("foo")')).rejects.toThrow(/createUnit is disabled/);
});

test('calculator is usable through ToolRegistry.execute', async () => {
  const registry = new ToolRegistry([calculatorTool]);
  const call = (args: unknown): ToolCall => ({
    id: 'call_1',
    type: 'function',
    function: { name: 'calculator', arguments: JSON.stringify(args) },
  });

  const ok = await registry.execute(call({ expression: '12345 * 6789' }), makeCtx());
  expect(ok).toMatchObject({
    ok: true,
    output: { expression: '12345 * 6789', result: '83810205' },
  });

  const tooLong = await registry.execute(call({ expression: '1'.repeat(201) }), makeCtx());
  expect(tooLong.ok).toBe(false);

  const bad = await registry.execute(call({ expression: 'f(x) = x^2' }), makeCtx());
  expect(bad).toMatchObject({
    ok: false,
    error: 'Expression must produce a single value, e.g. "2 * (3 + 4)".',
  });
});
