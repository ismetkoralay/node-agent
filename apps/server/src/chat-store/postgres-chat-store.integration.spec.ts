import type { Message } from '@node-agent/core';
import { describeChatStore } from '@node-agent/core/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, expect, inject, test } from 'vitest';
import { conversationsTable } from '../database/database.schema.ts';
import { PostgresChatStore } from './postgres-chat-store.ts';

// Every test that touches the database lives in this one file: files run in parallel against the
// same container, and a second file truncating these tables would delete this file's data.
const pool = new Pool({ connectionString: inject('databaseUrl') });
const db = drizzle({ client: pool });

async function freshStore() {
  await db.execute(sql`truncate conversations cascade`); // cascade also clears messages
  return new PostgresChatStore(db);
}

afterAll(async () => {
  await pool.end();
});

describeChatStore('PostgresChatStore', freshStore);

test('appendMessages rolls back everything when one message is rejected', async () => {
  const store = await freshStore();
  const conv = await store.createConversation();
  const invalid = { role: 'foo', content: 'x' } as unknown as Message;

  await expect(
    store.appendMessages(conv.id, [{ role: 'user', content: 'valid' }, invalid]),
  ).rejects.toMatchObject({
    name: 'DrizzleQueryError',
    cause: { code: '23514' }, // check_violation on messages_role_check
  });

  expect(await store.getMessages(conv.id)).toEqual([]);

  // The messages come from a single INSERT, so an empty history alone would also pass without a
  // transaction. The rolled-back `updated_at` bump is what proves the transaction.
  const [row] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conv.id));
  expect(row?.updated_at).toStrictEqual(row?.created_at);
});

test('appendMessages keeps every message when called concurrently on one conversation', async () => {
  const store = await freshStore();
  const conv = await store.createConversation();
  const contents = Array.from({ length: 10 }, (_, i) => `message ${i}`);

  await Promise.all(
    contents.map((content) => store.appendMessages(conv.id, [{ role: 'user', content }])),
  );

  const stored = await store.getMessages(conv.id);
  expect(stored.map((m) => m.content).sort()).toEqual([...contents].sort());

  const { rows } = await pool.query<{ seq: number }>(
    'select seq from messages where conversation_id = $1 order by seq',
    [conv.id],
  );
  expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
});
