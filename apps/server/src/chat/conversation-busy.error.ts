import { AgentError } from '@node-agent/core';

export class ConversationBusyError extends AgentError {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Requested conversation with ID: ${conversationId} is busy`, 'conversation_busy');
    this.name = 'ConversationBusyError';
    this.conversationId = conversationId;
  }
}
