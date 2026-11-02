import {
  AgentError,
  type ChatStore,
  type Conversation,
  ConversationNotFoundError,
  type Message,
} from '@node-agent/core';
import { asc, eq, max, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { conversationsTable, messagesTable } from '../database/database.schema.ts';
import { messageToRow, rowToMessage } from './message-row.ts';

type ConversationRow = typeof conversationsTable.$inferSelect;

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title ?? undefined,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export class PostgresChatStore implements ChatStore {
  constructor(private readonly db: NodePgDatabase) {}

  async createConversation(input?: {
    title?: string;
    metadata?: Record<string, string>;
  }): Promise<Conversation> {
    const [row] = await this.db
      .insert(conversationsTable)
      .values({
        title: input?.title ?? null,
        metadata: input?.metadata ?? {},
      })
      .returning();
    if (!row) {
      throw new AgentError('Insert into conversations returned no row', 'store_insert_failed');
    }
    return rowToConversation(row);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const [row] = await this.db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id));
    return row ? rowToConversation(row) : null;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    if (!(await this.getConversation(conversationId))) {
      throw new ConversationNotFoundError(conversationId);
    }

    const rows = await this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversation_id, conversationId))
      .orderBy(asc(messagesTable.seq));
    return rows.map(rowToMessage);
  }

  /**
   * Runs in one transaction that starts with an `UPDATE` of the conversation row. That one
   * statement checks the conversation exists, bumps `updated_at` and takes a row lock, so
   * concurrent appenders to the same conversation queue up and each sees the latest `max(seq)`.
   */
  async appendMessages(conversationId: string, messages: Message[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .update(conversationsTable)
        .set({ updated_at: sql`now()` })
        .where(eq(conversationsTable.id, conversationId))
        .returning({ id: conversationsTable.id });
      if (!locked) {
        throw new ConversationNotFoundError(conversationId);
      }

      if (messages.length === 0) {
        return;
      }

      const [last] = await tx
        .select({ seq: sql<number>`coalesce(${max(messagesTable.seq)}, 0)` })
        .from(messagesTable)
        .where(eq(messagesTable.conversation_id, conversationId));
      const start = last?.seq ?? 0;

      await tx
        .insert(messagesTable)
        .values(messages.map((m, i) => messageToRow(conversationId, start + i + 1, m)));
    });
  }
}
