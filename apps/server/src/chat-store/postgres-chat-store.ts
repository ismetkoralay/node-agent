import {
  AgentError,
  type ChatStore,
  type Conversation,
  type ConversationList,
  ConversationNotFoundError,
  InvalidCursorError,
  type Message,
  titleFromMessages,
} from '@node-agent/core';
import { asc, desc, eq, max, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
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

/**
 * The cursor is the `(updated_at, id)` of the last row of a page. `updated_at` travels as the text
 * Postgres produced, with microseconds: a JavaScript `Date` keeps only milliseconds, and rounding
 * the cursor down would skip every row that was updated within the same millisecond.
 */
const cursorSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});

type Cursor = z.infer<typeof cursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return cursorSchema.parse(json);
  } catch (error) {
    throw new InvalidCursorError({ cause: error });
  }
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

  async listConversations(limit: number, cursor?: string): Promise<ConversationList> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    const after = cursor === undefined ? undefined : decodeCursor(cursor);

    // Row comparison matches the index on (updated_at, id) and breaks ties between rows that
    // share an `updated_at`.
    const afterCursor = after
      ? sql`(${conversationsTable.updated_at}, ${conversationsTable.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`
      : undefined;

    // One extra row tells whether another page exists.
    const rows = await this.db
      .select({
        id: conversationsTable.id,
        title: conversationsTable.title,
        updatedAt: conversationsTable.updated_at,
        updatedAtExact: sql<string>`to_char(${conversationsTable.updated_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        messageCount: sql<number>`(select count(*)::int from ${messagesTable} where ${messagesTable.conversation_id} = ${conversationsTable.id})`,
      })
      .from(conversationsTable)
      .where(afterCursor)
      .orderBy(desc(conversationsTable.updated_at), desc(conversationsTable.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      conversations: page.map((row) => ({
        id: row.id,
        title: row.title ?? undefined,
        updatedAt: row.updatedAt,
        messageCount: row.messageCount,
      })),
      nextCursor:
        last && rows.length > limit
          ? encodeCursor({ updatedAt: last.updatedAtExact, id: last.id })
          : null,
    };
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
   * statement checks the conversation exists, bumps `updated_at`, gives an untitled conversation
   * its title and takes a row lock, so concurrent appenders to the same conversation queue up and
   * each sees the latest `max(seq)`.
   */
  async appendMessages(conversationId: string, messages: Message[]): Promise<void> {
    const title = titleFromMessages(messages);
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .update(conversationsTable)
        .set({
          updated_at: sql`now()`,
          // `nullif` so that an empty title counts as no title, as it does in the in-memory store.
          ...(title !== undefined && {
            title: sql`coalesce(nullif(${conversationsTable.title}, ''), ${title})`,
          }),
        })
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
