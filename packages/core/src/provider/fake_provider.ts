import type { ChatRequest, ChatResponse } from '../types/chat.ts';
import type { LLMProvider } from './llm_provider.ts';

/**
 * A scripted `LLMProvider` for tests, so agent code can be exercised without a real backend.
 * Each `chat` call consumes the next scripted item: a response is returned, an `Error` is thrown.
 */
export class FakeProvider implements LLMProvider {
  readonly name = 'fake';

  /** Every request received, in call order. */
  readonly requests: ChatRequest[] = [];

  readonly #script: (ChatResponse | Error)[];

  constructor(script: (ChatResponse | Error)[]) {
    this.#script = [...script];
  }

  async chat(request: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatResponse> {
    opts?.signal?.throwIfAborted();
    this.requests.push(request);

    const next = this.#script.shift();
    if (next === undefined) {
      throw new Error(`FakeProvider: script exhausted after ${this.requests.length - 1} call(s)`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
