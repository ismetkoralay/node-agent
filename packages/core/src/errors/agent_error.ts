/** Base class for every error this project throws on purpose; `code` is a stable, machine-readable identifier. */
export class AgentError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentError';
    this.code = code;
  }
}
