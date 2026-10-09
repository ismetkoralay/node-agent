import type { ChatRequest, ChatResponse, LLMProvider } from '@node-agent/core';
import { ProviderError } from '@node-agent/core';
import { Ollama, type ChatResponse as OllamaResponse } from 'ollama';
import { PROVIDER_NAME } from './constants.ts';
import { fromOllamaResponse, toOllamaRequest } from './mapping.ts';

/** Constructor options for `OllamaProvider`. */
export type OllamaProviderOptions = {
  /** Ollama server URL. Defaults to the client's default (`http://127.0.0.1:11434`). */
  baseUrl?: string;
  /** A ready-made client; lets tests inject a fake. Takes precedence over `baseUrl`. */
  client?: Pick<Ollama, 'chat'>;
};

/** `LLMProvider` backed by a local or remote Ollama server. Plain chat only. */
export class OllamaProvider implements LLMProvider {
  readonly name = PROVIDER_NAME;

  readonly #client: Pick<Ollama, 'chat'>;

  constructor(opts: OllamaProviderOptions = {}) {
    this.#client = opts.client ?? new Ollama(opts.baseUrl ? { host: opts.baseUrl } : undefined);
  }

  async chat(request: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatResponse> {
    const signal = opts?.signal;
    signal?.throwIfAborted();
    // Outside the try: a request we cannot translate is our error, not a failure to reach Ollama.
    const ollamaRequest = toOllamaRequest(request);
    const abortWatch = signal ? watchAbort(signal) : undefined;
    let res: OllamaResponse;
    try {
      const call = this.#client.chat(ollamaRequest);
      // The Ollama client cannot cancel a non-streaming request, so we stop waiting for it.
      res = await (abortWatch ? Promise.race([call, abortWatch.rejection]) : call);
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      throw toProviderError(err, request.model);
    } finally {
      // The caller may reuse one signal for many calls; don't leave a listener behind on each.
      abortWatch?.dispose();
    }

    return fromOllamaResponse(res);
  }
}

/** Rejects with `signal.reason` on abort. `dispose` removes the listener once it's no longer needed. */
function watchAbort(signal: AbortSignal): { rejection: Promise<never>; dispose: () => void } {
  let onAbort!: () => void;
  const rejection = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return { rejection, dispose: () => signal.removeEventListener('abort', onAbort) };
}

function toProviderError(err: unknown, model: string): ProviderError {
  const status = (err as { status_code?: unknown } | null)?.status_code;
  const detail = err instanceof Error ? err.message : String(err);

  if (typeof status === 'number') {
    if (status === 404) {
      return new ProviderError(`Ollama model "${model}" not found. Run: ollama pull ${model}`, {
        provider: PROVIDER_NAME,
        retryable: false,
        cause: err,
      });
    }
    return new ProviderError(`Ollama request failed (HTTP ${status}): ${detail}`, {
      provider: PROVIDER_NAME,
      retryable: status === 429 || status >= 500,
      cause: err,
    });
  }
  // No HTTP status: the request never got an answer (connection refused, DNS, reset).
  return new ProviderError(`Could not reach Ollama: ${detail}`, {
    provider: PROVIDER_NAME,
    retryable: true,
    cause: err,
  });
}
