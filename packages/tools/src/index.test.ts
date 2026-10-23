import { expect, test } from 'vitest';
import { calculatorTool, getCurrentTimeTool } from './index.ts';

test('entry point exports the tools', () => {
  expect(calculatorTool.name).toBe('calculator');
  expect(getCurrentTimeTool.name).toBe('get_current_time');
});
