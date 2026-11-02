import { ConversationNotFoundError } from '../errors/conversation_not_found_error.ts';
import { InvalidCursorError } from '../errors/invalid_cursor_error.ts';
import type { Message } from '../types/message.ts';
import type { ChatStore, Conversation, ConversationList } from './chat_store.ts';
import { titleFromMessages } from './conversation_title.ts';

type Entry = {
  conversation: Conversation;
  messages: Message[];
  updatedAt: Date;
  /** Position in the order of activity; a `Date` has millisecond resolution, so it cannot order events that share a millisecond. */
  activity: number;
};

/** A `ChatStore` that keeps everything in process memory; nothing survives a restart. */
export class InMemoryChatStore implements ChatStore {
  private readonly conversations = new Map<string, Entry>();
  private clock = 0;

  async createConversation(input?: {
    title?: string;
    metadata?: Record<string, string>;
  }): Promise<Conversation> {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: input?.title,
      metadata: structuredClone(input?.metadata ?? {}),
      createdAt: new Date(),
    };
    this.conversations.set(conversation.id, {
      conversation,
      messages: [],
      updatedAt: conversation.createdAt,
      activity: ++this.clock,
    });
    return structuredClone(conversation);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const entry = this.conversations.get(id);
    return entry ? structuredClone(entry.conversation) : null;
  }

  async listConversations(limit: number, cursor?: string): Promise<ConversationList> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    const before = cursor === undefined ? Number.POSITIVE_INFINITY : decodeCursor(cursor);

    const newestFirst = [...this.conversations.values()]
      .filter((entry) => entry.activity < before)
      .sort((a, b) => b.activity - a.activity);
    const page = newestFirst.slice(0, limit);
    const last = page.at(-1);

    return {
      conversations: page.map((entry) => ({
        id: entry.conversation.id,
        title: entry.conversation.title,
        updatedAt: new Date(entry.updatedAt),
        messageCount: entry.messages.length,
      })),
      nextCursor: last && newestFirst.length > limit ? String(last.activity) : null,
    };
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return structuredClone(this.require(conversationId).messages);
  }

  async appendMessages(conversationId: string, messages: Message[]): Promise<void> {
    const entry = this.require(conversationId);
    entry.messages.push(...structuredClone(messages));
    entry.updatedAt = new Date();
    entry.activity = ++this.clock;
    if (!entry.conversation.title) {
      entry.conversation.title = titleFromMessages(messages);
    }
  }

  private require(conversationId: string): Entry {
    const entry = this.conversations.get(conversationId);
    if (!entry) {
      throw new ConversationNotFoundError(conversationId);
    }
    return entry;
  }
}

function decodeCursor(cursor: string): number {
  if (!/^[1-9]\d*$/.test(cursor)) {
    throw new InvalidCursorError();
  }
  return Number(cursor);
}
