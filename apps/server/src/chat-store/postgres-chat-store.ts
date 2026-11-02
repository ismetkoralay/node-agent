import { Inject } from '@nestjs/common';
import {
  type ChatStore,
  type Conversation,
  ConversationNotFoundError,
  type Message,
} from '@node-agent/core';
import { asc, eq, max, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../database/database.module.ts';
import { conversationsTable, messagesTable } from '../database/database.schema.ts';
import { messageToRow, rowToMessage } from './message-row.ts';

export class PostgresChatStore implements ChatStore {
  constructor(@Inject(DB) private readonly db: NodePgDatabase) {}

  async createConversation(input?: {
    title?: string;
    metadata?: Record<string, string>;
  }): Promise<Conversation> {
    const [conversation] = await this.db
      .insert(conversationsTable)
      .values({
        title: input?.title ?? null,
        metadata: input?.metadata ?? {},
      })
      .returning();
    return {
      id: conversation?.id ?? '',
      title: conversation?.title ?? undefined,
      metadata: conversation?.metadata ?? {},
      createdAt: conversation?.created_at ?? new Date(),
    };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const [conversation] = await this.db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id));
    if (!conversation) {
      return null;
    }
    return {
      id: conversation.id,
      title: conversation.title ?? undefined,
      metadata: conversation.metadata,
      createdAt: conversation.created_at,
    };
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const conv = await this.getConversation(conversationId);
    if (!conv) {
      throw new ConversationNotFoundError(conversationId);
    }

    const res = await this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversation_id, conversationId))
      .orderBy(asc(messagesTable.seq));
    return res.map((row) => rowToMessage(row));
  }

  async appendMessages(conversationId: string, messages: Message[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .update(conversationsTable)
        .set({ updated_at: sql`now()` })
        .where(eq(conversationsTable.id, conversationId))
        .returning();
      if (!conversation) {
        throw new ConversationNotFoundError(conversationId);
      }

      if (messages.length === 0) {
        return;
      }

      let seq = 0;
      const [maxSeq] = await tx
        .select({
          maxSeq: sql<number>`COALESCE(${max(messagesTable.seq)}, 0)`,
        })
        .from(messagesTable)
        .where(eq(messagesTable.conversation_id, conversationId));
      if (!maxSeq) {
        seq = 0;
      } else {
        seq = maxSeq.maxSeq;
      }

      await tx
        .insert(messagesTable)
        .values(messages.map((m, i) => messageToRow(conversationId, seq + i + 1, m)));
    });
  }
}
