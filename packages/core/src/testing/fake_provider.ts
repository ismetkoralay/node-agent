import { setTimeout as sleep } from 'node:timers/promises';
import type { LLMProvider } from '../provider/llm_provider.ts';
import type { ChatRequest, ChatResponse } from '../types/chat.ts';

/** One scripted step: a response to return, an error to throw, or a function that builds the response from the request. */
export type FakeProviderStep = ChatResponse | Error | ((request: ChatRequest) => ChatResponse);

export type FakeProviderOptions = {
  /** Time each `chat` call waits before settling; the wait ends early if the signal aborts. */
  delayMs?: number;
};

/**
 * A scripted `LLMProvider` for tests, so agent code can be exercised without a real backend.
 * Each `chat` call consumes the next scripted step: a response is returned, an `Error` is thrown,
 * a function is called with the request and its result is returned.
 */
export class FakeProvider implements LLMProvider {
  readonly name = 'fake';

  /** A copy of every request received, in call order, as it was when the call was made. */
  readonly requests: ChatRequest[] = [];

  readonly #script: FakeProviderStep[];
  readonly #delayMs: number;

  constructor(script: FakeProviderStep[], options: FakeProviderOptions = {}) {
    this.#script = [...script];
    this.#delayMs = options.delayMs ?? 0;
  }

  async chat(request: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatResponse> {
    const signal = opts?.signal;
    signal?.throwIfAborted();
    this.requests.push(structuredClone(request));

    const next = this.#script.shift();
    if (next === undefined) {
      throw new Error(`FakeProvider: no response scripted for call ${this.requests.length}`);
    }

    if (this.#delayMs > 0) {
      await wait(this.#delayMs, signal);
    }

    if (next instanceof Error) {
      throw next;
    }
    if (typeof next === 'function') {
      return next(request);
    }
    return next;
  }
}

/** Waits `ms`; on abort it stops at once and rejects with `signal.reason`, not Node's wrapping `AbortError`. */
async function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  try {
    await sleep(ms, undefined, { signal });
  } catch (err) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    throw err;
  }
}
