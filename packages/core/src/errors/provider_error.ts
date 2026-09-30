import { AgentError } from './agent_error.ts';

/**
 * A failure while talking to an LLM backend. The original error, if any, is kept as `cause`.
 *
 * `retryable` is information only: providers never retry, the caller decides.
 */
export class ProviderError extends AgentError {
  /** The `name` of the `LLMProvider` that failed. */
  readonly provider: string;
  /** Whether repeating the same request might succeed (e.g. a timeout, not a bad request). */
  readonly retryable: boolean;

  constructor(message: string, opts: { provider: string; retryable: boolean; cause?: unknown }) {
    super(message, 'provider_error', opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'ProviderError';
    this.provider = opts.provider;
    this.retryable = opts.retryable;
  }
}
