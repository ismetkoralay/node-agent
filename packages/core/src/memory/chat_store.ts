import type { Message } from '../types/message.ts';

/** A conversation's identity and descriptive fields; its messages live in the `ChatStore`. */
export type Conversation = {
  id: string;
  title?: string;
  metadata: Record<string, string>;
  createdAt: Date;
};

/** One row of a conversation listing: enough to render a history sidebar without the messages. */
export type ConversationSummary = {
  id: string;
  title?: string;
  /** Last time a message was appended (the creation time while there are none). */
  updatedAt: Date;
  messageCount: number;
};

/** One page of `listConversations`; `nextCursor` is `null` on the last page. */
export type ConversationList = {
  conversations: ConversationSummary[];
  nextCursor: string | null;
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
  /**
   * Also bumps the conversation's `updatedAt`, and gives an untitled conversation a title taken
   * from its first user message (see `titleFromMessages`). An existing title is never replaced.
   */
  appendMessages(conversationId: string, messages: Message[]): Promise<void>;
  /**
   * Most recently updated first. Pass the `nextCursor` of a page to get the page after it; a cursor
   * is opaque and only valid for the store that issued it. Throws `InvalidCursorError` for a cursor
   * it cannot read and `RangeError` when `limit` is not a positive integer.
   */
  listConversations(limit: number, cursor?: string): Promise<ConversationList>;
}
