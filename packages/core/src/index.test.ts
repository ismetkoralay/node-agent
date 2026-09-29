import { expect, test } from 'vitest';
import { VERSION } from './index.ts';

test('exports VERSION as a string', () => {
  expect(typeof VERSION).toBe('string');
});
