import { AgentError } from './agent_error.ts';

/** A pagination cursor that the store did not issue, or can no longer read. */
export class InvalidCursorError extends AgentError {
  constructor(options?: ErrorOptions) {
    super('The cursor is not valid', 'invalid_cursor', options);
    this.name = 'InvalidCursorError';
  }
}
