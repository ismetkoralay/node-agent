import { ConversationNotFoundError } from '../errors/conversation_not_found_error.ts';
import type { Message } from '../types/message.ts';
import type { ChatStore, Conversation } from './chat_store.ts';

/** A `ChatStore` that keeps everything in process memory; nothing survives a restart. */
export class InMemoryChatStore implements ChatStore {
  private readonly conversations = new Map<
    string,
    { conversation: Conversation; messages: Message[] }
  >();

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
    this.conversations.set(conversation.id, { conversation, messages: [] });
    return structuredClone(conversation);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const entry = this.conversations.get(id);
    return entry ? structuredClone(entry.conversation) : null;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return structuredClone(this.require(conversationId).messages);
  }

  async appendMessages(conversationId: string, messages: Message[]): Promise<void> {
    this.require(conversationId).messages.push(...structuredClone(messages));
  }

  private require(conversationId: string): { conversation: Conversation; messages: Message[] } {
    const entry = this.conversations.get(conversationId);
    if (!entry) {
      throw new ConversationNotFoundError(conversationId);
    }
    return entry;
  }
}
