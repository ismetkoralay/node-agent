import type { Message } from '@node-agent/core';
import { describeChatStore } from '@node-agent/core/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, expect, inject, test } from 'vitest';
import { conversationsTable } from '../database/database.schema.ts';
import { PostgresChatStore } from './postgres-chat-store.ts';

const pool = new Pool({ connectionString: inject('databaseUrl') });
const db = drizzle({ client: pool });

async function freshStore() {
  await db.execute(sql`truncate conversations cascade`); // cascade mesajları da siler
  return new PostgresChatStore(db);
}

afterAll(async () => {
  await pool.end();
});

describeChatStore('PostgresChatStore', freshStore);

test('appendMessages should throw if the role is not assistant, system, or tool', async () => {
  const store = await freshStore();
  const conv = await store.createConversation();
  // biome-ignore lint/suspicious/noExplicitAny: Ignored for the line below to test invalid message role binding.
  const messages = [{ role: 'invalid-role', content: 'Invalid role message' } as any as Message];

  await expect(store.appendMessages(conv.id, messages)).rejects.toMatchObject({
    name: 'DrizzleQueryError',
    cause: {
      code: '23514', // PostgreSQL error code for check constraint violation
    },
  });

  const [fetchedConv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conv.id));
  expect(fetchedConv).toBeDefined();
  expect(fetchedConv?.updated_at).toStrictEqual(conv.createdAt); // Ensure the conversation's updated_at timestamp hasn't changed

  const fetchedMessages = await store.getMessages(conv.id);
  expect(fetchedMessages).toHaveLength(0);
});

test('appendMessages process 10 parallel calls in random order', async () => {
  const store = await freshStore();
  const conv = await store.createConversation();
  try {
    await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const messages = [{ role: 'assistant', content: `Message ${i}` } as Message];
        await store.appendMessages(conv.id, messages);
      }),
    );
  } catch (_error) {
    expect.unreachable('appendMessages should not throw an error when processing parallel calls');
  }

  const messages = await store.getMessages(conv.id);
  expect(messages).toHaveLength(10);
});
