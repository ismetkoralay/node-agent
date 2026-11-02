import { InvalidCursorError, type Message } from '@node-agent/core';
import { describeChatStore } from '@node-agent/core/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, inject, test } from 'vitest';
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

describe('listConversations paging over equal and near-equal updated_at values', () => {
  /** Inserts rows with exact timestamps, which the `ChatStore` interface cannot do. */
  async function insertAt(updatedAt: string, count: number): Promise<string[]> {
    const ids = Array.from({ length: count }, () => crypto.randomUUID());
    for (const id of ids) {
      await pool.query(
        'insert into conversations (id, title, created_at, updated_at) values ($1, $2, $3, $3)',
        [id, id, updatedAt],
      );
    }
    return ids;
  }

  async function walk(store: PostgresChatStore, limit: number): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.listConversations(limit, cursor);
      ids.push(...page.conversations.map((c) => c.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  }

  test('rows sharing one updated_at are split by id and none is skipped or repeated', async () => {
    const store = await freshStore();
    const ids = await insertAt('2026-01-01T00:00:00.123456Z', 7);

    expect(await walk(store, 2)).toEqual([...ids].sort().reverse());
  });

  test('rows within one millisecond but different microseconds keep their order', async () => {
    // A cursor rounded to milliseconds would skip the rows between .123000 and the cursor row.
    const store = await freshStore();
    const late = await insertAt('2026-01-01T00:00:00.123900Z', 2);
    const middle = await insertAt('2026-01-01T00:00:00.123456Z', 2);
    const early = await insertAt('2026-01-01T00:00:00.123100Z', 2);
    const before = await insertAt('2026-01-01T00:00:00.122999Z', 1);

    const expected = [late, middle, early].flatMap((group) => [...group].sort().reverse());
    expect(await walk(store, 1)).toEqual([...expected, ...before]);
    expect(await walk(store, 3)).toEqual([...expected, ...before]);
  });

  test('a well-formed cursor that points at no existing row still pages from its position', async () => {
    const store = await freshStore();
    const [newer] = await insertAt('2026-01-02T00:00:00.000000Z', 1);
    const [older] = await insertAt('2026-01-01T00:00:00.000000Z', 1);
    const cursor = Buffer.from(
      JSON.stringify({ updatedAt: '2026-01-01T12:00:00.000000Z', id: crypto.randomUUID() }),
    ).toString('base64url');

    const page = await store.listConversations(10, cursor);

    expect(page.conversations.map((c) => c.id)).toEqual([older]);
    expect(newer).toBeDefined();
  });

  test.each([
    [
      'a well-formed cursor with a bad timestamp',
      { updatedAt: 'yesterday', id: crypto.randomUUID() },
    ],
    ['a well-formed cursor with a bad id', { updatedAt: '2026-01-01T00:00:00.000000Z', id: 'x' }],
    ['a cursor missing the id', { updatedAt: '2026-01-01T00:00:00.000000Z' }],
  ])('rejects %s with InvalidCursorError', async (_name, payload) => {
    const store = await freshStore();
    const cursor = Buffer.from(JSON.stringify(payload)).toString('base64url');

    await expect(store.listConversations(10, cursor)).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

test('appendMessages titles an untitled conversation only once, even when called concurrently', async () => {
  const store = await freshStore();
  const conv = await store.createConversation();

  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      store.appendMessages(conv.id, [{ role: 'user', content: `question ${i}` }]),
    ),
  );

  const title = (await store.getConversation(conv.id))?.title;
  const contents = (await store.getMessages(conv.id)).map((m) => m.content);
  expect(title).toMatch(/^question \d$/);
  // The row lock makes the second appender see the title the first one set.
  expect(title).toBe(contents[0]);
});
