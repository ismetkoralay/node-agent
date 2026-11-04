import { expect, test } from 'vitest';
import {
  AgentError,
  ChunkCollector,
  collectStream,
  createAgent,
  ProviderError,
  responseToChunks,
  VERSION,
} from './index.ts';

test('exports VERSION as a string', () => {
  expect(typeof VERSION).toBe('string');
});

test('exports the error classes from the package root', () => {
  expect(new ProviderError('x', { provider: 'p', retryable: false })).toBeInstanceOf(AgentError);
});

test('exports the streaming helpers from the package root', () => {
  expect(typeof ChunkCollector).toBe('function');
  expect(typeof collectStream).toBe('function');
  expect(typeof responseToChunks).toBe('function');
});

test('exports createAgent from the package root', () => {
  expect(typeof createAgent).toBe('function');
});
