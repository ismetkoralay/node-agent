import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { type ChatStore, createAgent } from '@node-agent/core';
import { FakeProvider, textResponse, toolCallResponse } from '@node-agent/core/testing';
import { getCurrentTimeTool } from '@node-agent/tools';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { LoggerModule } from 'nestjs-pino';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { AGENT, CHAT_STORE } from '../agent/tokens.ts';
import { PostgresChatStore } from '../chat-store/postgres-chat-store.ts';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.ts';
import { ChatController } from './chat.controller.ts';
import { ChatService } from './chat.service.ts';

type ToolFlowMessage = {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: { function: { name: string } }[];
};

describe('Chat Controller', () => {
  // The list tests count rows, so this file gets a database of its own.
  let database: TestDatabase;
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  let app: INestApplication;
  let store: ChatStore;
  let baseUrl: string;

  async function start(provider: FakeProvider) {
    store = new PostgresChatStore(db);
    const agent = createAgent({
      model: 'test-model',
      provider,
      store,
      tools: [getCurrentTimeTool],
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: 'silent',
          },
        }),
      ],
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: CHAT_STORE, useValue: store },
        { provide: AGENT, useValue: agent },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = `${await app.getUrl()}/v1/conversations`;
  }

  async function post(path: string, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  type ErrorBody = {
    error: {
      code: string;
      message: string;
      requestId: string;
      details?: { path: string; message: string }[];
    };
  };

  beforeAll(async () => {
    database = await createTestDatabase(inject('databaseUrl'));
    pool = new Pool({ connectionString: database.url });
    db = drizzle({ client: pool });
  });

  afterAll(async () => {
    await pool.end();
    await database.drop();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate conversations cascade`); // cascade also clears messages
    await start(new FakeProvider([textResponse('hello from provider')]));
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/conversations', () => {
    test('returns 201 and keeps title and metadata', async () => {
      const res = await post('', { title: 'my title', metadata: { a: 'b' } });

      expect(res.status).toBe(201);
      const body = await json<{ id: string; title: string; createdAt: string }>(res);
      expect(body.title).toBe('my title');
      expect(body.createdAt).toEqual(expect.any(String));

      const stored = await store.getConversation(body.id);
      expect(stored?.metadata).toStrictEqual({ a: 'b' });
    });

    test('accepts an empty body', async () => {
      const res = await post('');

      expect(res.status).toBe(201);
    });

    test('rejects invalid metadata with 400 validation_error', async () => {
      const res = await post('', { metadata: { a: 1 } });

      expect(res.status).toBe(400);
      const { error } = await json<ErrorBody>(res);
      expect(error).toMatchObject({
        code: 'validation_error',
        message: 'Request validation failed',
      });
      expect(error.details).toMatchObject([{ path: 'metadata.a' }]);
    });
  });

  describe('GET /v1/conversations', () => {
    type Page = {
      conversations: { id: string; title?: string; updatedAt: string; messageCount: number }[];
      nextCursor: string | null;
    };

    /** Creates `count` conversations one after another, so the last one is the newest. */
    async function seed(count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        ids.push((await store.createConversation({ title: `conv ${i}` })).id);
      }
      return ids;
    }

    test('returns an empty page when there are no conversations', async () => {
      const res = await fetch(baseUrl);

      expect(res.status).toBe(200);
      expect(await json<Page>(res)).toStrictEqual({ conversations: [], nextCursor: null });
    });

    test('returns id, title, updatedAt as an ISO string and messageCount', async () => {
      const [id] = await seed(1);
      await post(`/${id}/messages`, { content: 'hello' });

      const page = await json<Page>(await fetch(baseUrl));

      expect(page.conversations).toStrictEqual([
        { id, title: 'conv 0', updatedAt: expect.any(String), messageCount: 2 },
      ]);
      const [item] = page.conversations;
      expect(new Date(item?.updatedAt ?? '').toISOString()).toBe(item?.updatedAt);
    });

    test('lists the most recently updated conversation first', async () => {
      const [a, b, c] = await seed(3);
      await post(`/${a}/messages`, { content: 'bump' });

      const page = await json<Page>(await fetch(baseUrl));

      expect(page.conversations.map((x) => x.id)).toStrictEqual([a, c, b]);
    });

    test('without a limit returns 20 conversations and a nextCursor', async () => {
      await seed(25);

      const page = await json<Page>(await fetch(baseUrl));

      expect(page.conversations).toHaveLength(20);
      expect(page.nextCursor).toEqual(expect.any(String));
    });

    test('pages through 25 conversations with limit=20: 20 then 5, then nextCursor is null', async () => {
      const ids = await seed(25);

      const first = await json<Page>(await fetch(`${baseUrl}?limit=20`));
      const second = await json<Page>(
        await fetch(`${baseUrl}?limit=20&cursor=${encodeURIComponent(first.nextCursor ?? '')}`),
      );

      expect(first.conversations).toHaveLength(20);
      expect(second.conversations).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      expect([...first.conversations, ...second.conversations].map((c) => c.id)).toStrictEqual(
        [...ids].reverse(),
      );
    });

    test('a conversation without a title gets one from its first message', async () => {
      const { id } = await json<{ id: string }>(await post('', {}));

      await post(`/${id}/messages`, { content: 'What is the weather like in Istanbul today?' });

      const page = await json<Page>(await fetch(baseUrl));
      expect(page.conversations[0]?.title).toBe('What is the weather like in Istanbul today?');
    });

    test.each([
      ['limit=0', 'limit'],
      ['limit=101', 'limit'],
      ['limit=-1', 'limit'],
      ['limit=1.5', 'limit'],
      ['limit=abc', 'limit'],
      ['limit=', 'limit'],
      ['limit=1&limit=2', 'limit'],
      ['cursor=', 'cursor'],
    ])('returns 400 validation_error for ?%s', async (query, path) => {
      const res = await fetch(`${baseUrl}?${query}`);

      expect(res.status).toBe(400);
      const { error } = await json<ErrorBody>(res);
      expect(error.code).toBe('validation_error');
      expect(error.details).toMatchObject([{ path }]);
    });

    test.each([1, 100])('accepts limit=%i', async (limit) => {
      const res = await fetch(`${baseUrl}?limit=${limit}`);

      expect(res.status).toBe(200);
    });

    test('returns 400 invalid_cursor for a cursor the server did not issue', async () => {
      await seed(2);

      const res = await fetch(`${baseUrl}?cursor=not-a-cursor`);

      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('invalid_cursor');
    });

    test('is not mistaken for GET /:id', async () => {
      const res = await fetch(baseUrl);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /v1/conversations/:id', () => {
    test('returns 400 validation_error for an invalid uuid', async () => {
      const res = await fetch(`${baseUrl}/not-a-uuid`);

      expect(res.status).toBe(400);
      const { error } = await json<ErrorBody>(res);
      expect(error.code).toBe('validation_error');
      expect(error.details).toStrictEqual([{ path: 'id', message: 'Invalid UUID' }]);
    });

    test('returns 404 conversation_not_found for an unknown conversation', async () => {
      const res = await fetch(`${baseUrl}/${crypto.randomUUID()}`);

      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.code).toBe('conversation_not_found');
    });
  });

  describe('POST /v1/conversations/:id/messages', () => {
    async function createConversation(): Promise<string> {
      const res = await post('', {});
      return (await json<{ id: string }>(res)).id;
    }

    test('returns 200 with the assistant message', async () => {
      const id = await createConversation();

      const res = await post(`/${id}/messages`, { content: 'hello' });

      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({
        message: { role: 'assistant', content: 'hello from provider' },
        finishReason: 'stop',
        steps: 1,
        usage: { promptTokens: expect.any(Number), completionTokens: expect.any(Number) },
      });
    });

    test.each([
      ['missing content', {}],
      ['empty content', { content: '' }],
      ['content over 8000 characters', { content: 'a'.repeat(8001) }],
    ])('returns 400 validation_error for %s', async (_name, payload) => {
      const id = await createConversation();

      const res = await post(`/${id}/messages`, payload);

      expect(res.status).toBe(400);
      const { error } = await json<ErrorBody>(res);
      expect(error.code).toBe('validation_error');
      expect(error.details).toMatchObject([{ path: 'content' }]);
    });

    test('returns 400 validation_error for an invalid uuid', async () => {
      const res = await post('/abc/messages', { content: 'hello' });

      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.details).toStrictEqual([
        { path: 'id', message: 'Invalid UUID' },
      ]);
    });

    test('accepts content of exactly 8000 characters', async () => {
      const id = await createConversation();

      const res = await post(`/${id}/messages`, { content: 'a'.repeat(8000) });

      expect(res.status).toBe(200);
    });

    test('returns 404 conversation_not_found for an unknown conversation', async () => {
      const res = await post(`/${crypto.randomUUID()}/messages`, { content: 'hello' });

      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.code).toBe('conversation_not_found');
    });
  });

  describe('GET /v1/conversations/:id/messages', () => {
    test('returns 404 conversation_not_found for an unknown conversation', async () => {
      const res = await fetch(`${baseUrl}/${crypto.randomUUID()}/messages`);

      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.code).toBe('conversation_not_found');
    });

    test('returns the full tool flow in order', async () => {
      await app.close();
      await start(
        new FakeProvider([
          toolCallResponse([{ name: 'get_current_time', args: { timezone: 'UTC' } }]),
          textResponse('it is noon'),
        ]),
      );
      const { id } = await json<{ id: string }>(await post('', {}));

      const sent = await post(`/${id}/messages`, { content: 'what time is it?' });
      expect(sent.status).toBe(200);

      const res = await fetch(`${baseUrl}/${id}/messages`);

      expect(res.status).toBe(200);
      const { messages } = await json<{ messages: ToolFlowMessage[] }>(res);
      expect(messages.map((m) => m.role)).toStrictEqual(['user', 'assistant', 'tool', 'assistant']);
      expect(messages[1]?.content).toBeNull();
      expect(messages[1]?.tool_calls?.[0]?.function.name).toBe('get_current_time');
      expect(messages[2]?.tool_call_id).toBe('call_1');
      expect(messages[3]?.content).toBe('it is noon');
    });
  });
});
