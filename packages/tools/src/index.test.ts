import { expect, test } from 'vitest';

test('entry point loads', async () => {
  await expect(import('./index.ts')).resolves.toBeDefined();
});
