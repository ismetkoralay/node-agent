import type { ToolContext } from '@node-agent/core';

/** A `ToolContext` with a silent logger, for tests that don't care about the context. */
export function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: '1',
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}
