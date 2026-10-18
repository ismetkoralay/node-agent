import type { Message } from '../types/message.ts';

/** A conversation's identity and descriptive fields; its messages live in the `ChatStore`. */
export type Conversation = {
  id: string;
  title?: string;
  metadata: Record<string, string>;
  createdAt: Date;
};

/**
 * Where conversation history is kept. The agent depends only on this contract, so an in-memory
 * store and a database-backed one are interchangeable. Implementations must return copies, never
 * references to their internal state, and throw `ConversationNotFoundError` when asked to read or
 * append messages of an unknown conversation.
 */
export interface ChatStore {
  createConversation(input?: {
    title?: string;
    metadata?: Record<string, string>;
  }): Promise<Conversation>;
  /** Resolves to `null` when the conversation does not exist. */
  getConversation(id: string): Promise<Conversation | null>;
  getMessages(conversationId: string): Promise<Message[]>;
  appendMessages(conversationId: string, messages: Message[]): Promise<void>;
}
