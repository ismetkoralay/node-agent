import { AgentError, type ToolCall, ToolRegistry, toToolDefinition } from '@node-agent/core';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getCurrentTimeTool } from './get_current_time.ts';
import { makeCtx } from './test_context.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const run = (timezone?: string) =>
  getCurrentTimeTool.execute(timezone === undefined ? {} : { timezone }, makeCtx());

test('get_current_time returns UTC now when timezone is omitted', async () => {
  await expect(run()).resolves.toEqual({
    timezone: 'UTC',
    iso: '2026-10-22T10:00:00+00:00',
    weekday: 'Thursday',
    utcOffset: '+00:00',
  });
});

test('get_current_time accepts UTC explicitly', async () => {
  await expect(run('UTC')).resolves.toEqual({
    timezone: 'UTC',
    iso: '2026-10-22T10:00:00+00:00',
    weekday: 'Thursday',
    utcOffset: '+00:00',
  });
});

test('get_current_time returns correct time for Europe/Istanbul', async () => {
  await expect(run('Europe/Istanbul')).resolves.toEqual({
    timezone: 'Europe/Istanbul',
    iso: '2026-10-22T13:00:00+03:00',
    weekday: 'Thursday',
    utcOffset: '+03:00',
  });
});

test('get_current_time returns correct time for America/New_York', async () => {
  await expect(run('America/New_York')).resolves.toEqual({
    timezone: 'America/New_York',
    iso: '2026-10-22T06:00:00-04:00',
    weekday: 'Thursday',
    utcOffset: '-04:00',
  });
});

test('get_current_time renders midnight as 00, not 24', async () => {
  vi.setSystemTime(new Date('2026-10-22T21:00:00Z'));

  await expect(run('Europe/Istanbul')).resolves.toMatchObject({
    iso: '2026-10-23T00:00:00+03:00',
    weekday: 'Friday',
  });
});

test('get_current_time throws for unrecognized timezone and keeps the RangeError', async () => {
  const err = await run('invalid/timezone').catch((e: unknown) => e);

  expect(err).toBeInstanceOf(AgentError);
  expect((err as AgentError).code).toBe('invalid_timezone');
  expect((err as AgentError).message).toBe(
    'Invalid timezone: invalid/timezone. Use an IANA name such as "Europe/Berlin" or "UTC".',
  );
  expect((err as AgentError).cause).toBeInstanceOf(RangeError);
});

test('get_current_time parameters are a plain object with an optional timezone', () => {
  const { parameters } = toToolDefinition(getCurrentTimeTool).function;

  expect(parameters).toMatchObject({ type: 'object' });
  expect(parameters).not.toHaveProperty('anyOf');
  expect(parameters).not.toHaveProperty('required');
});

test('get_current_time is usable through ToolRegistry.execute', async () => {
  const registry = new ToolRegistry([getCurrentTimeTool]);
  const call = (args: string): ToolCall => ({
    id: 'call_1',
    type: 'function',
    function: { name: 'get_current_time', arguments: args },
  });

  for (const args of ['{}', '', '{"timezone":"UTC"}']) {
    await expect(registry.execute(call(args), makeCtx())).resolves.toMatchObject({
      ok: true,
      output: { timezone: 'UTC', iso: '2026-10-22T10:00:00+00:00' },
    });
  }

  await expect(
    registry.execute(call('{"timezone":"Europe/Istanbul"}'), makeCtx()),
  ).resolves.toMatchObject({ ok: true, output: { iso: '2026-10-22T13:00:00+03:00' } });

  await expect(
    registry.execute(call('{"timezone":"Mars/Olympus"}'), makeCtx()),
  ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Mars/Olympus') });
});
