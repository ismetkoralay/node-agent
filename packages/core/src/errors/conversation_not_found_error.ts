import { AgentError } from './agent_error.ts';

/** A failure to find a conversation in the store. */
export class ConversationNotFoundError extends AgentError {
  readonly conversationId: string;

  constructor(conversationId: string, options?: ErrorOptions) {
    super(`Conversation ${conversationId} not found`, 'conversation_not_found', options);
    this.conversationId = conversationId;
    this.name = 'ConversationNotFoundError';
  }
}
