import type { ChatChunk, ChatRequest, ChatResponse } from '../types/chat.ts';

/**
 * The only thing an agent knows about a model backend: send a chat request, get a response
 * (whole via `chat()`, or piece by piece via the optional `stream()`).
 * Implementations (Ollama, Bedrock, ...) translate to and from their own wire format.
 * Keep it small: every new required method is something each provider has to implement.
 */
export interface LLMProvider {
  /**
   * The name of the LLM provider.
   */
  readonly name: string;

  /**
   * Sends a chat request to the LLM provider.
   * @param request The chat request.
   * @param opts Optional parameters for the request.
   * @param opts.signal Lets the caller cancel the request, either on demand
   *   (`controller.abort()`) or as a timeout (`AbortSignal.timeout(ms)`). Implementations must
   *   forward it to the underlying call and reject when it fires.
   * @returns A promise resolving to the chat response.
   * @throws {ProviderError} When the backend fails; `retryable` tells the caller whether a retry
   *   may help. The provider itself never retries.
   */
  chat(request: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatResponse>;

  /**
   * Optional: the same request, answered piece by piece. Ends with exactly one `finish` chunk.
   * Optional because not every provider can stream; callers must fall back to `chat()` when it
   * is absent.
   *
   * Nothing is thrown when `stream()` is called: errors surface while iterating. Breaking out of
   * the `for await` loop must release the underlying request.
   * @param request The chat request.
   * @param opts Optional parameters for the request.
   * @param opts.signal Lets the caller cancel the request, either on demand
   *   (`controller.abort()`) or as a timeout (`AbortSignal.timeout(ms)`). Implementations must
   *   forward it to the underlying call; when it fires, iteration ends by throwing
   *   `signal.reason`.
   * @returns The chunks of the answer, in order.
   * @throws {ProviderError} From iteration, when the backend fails; `retryable` tells the caller
   *   whether a retry may help. The provider itself never retries.
   */
  stream?(request: ChatRequest, opts?: { signal?: AbortSignal }): AsyncIterable<ChatChunk>;
}
