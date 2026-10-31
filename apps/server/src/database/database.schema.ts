import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const conversationsTable = pgTable('conversations', {
  id: uuid().primaryKey().defaultRandom(),
  title: text(),
  metadata: jsonb().notNull().default({}),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const messagesTable = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversation_id: uuid()
      .references(() => conversationsTable.id, { onDelete: 'cascade' })
      .notNull(),
    seq: integer().notNull(),
    content: text(),
    role: text().notNull(),
    tool_calls: jsonb(),
    tool_call_id: text(),
    metadata: jsonb().notNull().default({}),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('idx_uq_messages_conversation_id_seq').on(table.conversation_id, table.seq),
    check('messages_role_check', sql`${table.role} IN ('user', 'system', 'assistant', 'tool')`),
  ],
);
