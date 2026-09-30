import type { ChatRequest, ChatResponse } from '../types/chat.ts';

/**
 * The only thing an agent knows about a model backend: send a chat request, get a response.
 * Implementations (Ollama, Bedrock, ...) translate to and from their own wire format.
 * Keep it small: every new method is something each provider has to implement.
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
}
