import { AgentError } from './agent_error.ts';

/** A failure in tool setup, such as registering two tools under one name. */
export class ToolError extends AgentError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options);
    this.name = 'ToolError';
  }
}
