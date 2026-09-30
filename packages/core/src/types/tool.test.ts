import { expectTypeOf, test } from 'vitest';
import type { ToolCall, ToolDefinition } from '../index.ts';

test('ToolCall arguments is a JSON string and type is the function literal', () => {
  expectTypeOf<ToolCall['type']>().toEqualTypeOf<'function'>();
  expectTypeOf<ToolCall['function']['arguments']>().toBeString();
});

test('ToolDefinition requires name, description and parameters', () => {
  expectTypeOf<ToolDefinition['type']>().toEqualTypeOf<'function'>();
  expectTypeOf<ToolDefinition['function']>().toHaveProperty('parameters');
  expectTypeOf<{ name: string; description: string }>().not.toExtend<ToolDefinition['function']>();
});
