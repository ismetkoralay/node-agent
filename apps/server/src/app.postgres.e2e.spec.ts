import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeProvider, textResponse } from '@node-agent/core/testing';
import { getLoggerToken } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, inject, test, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { LLM_PROVIDER } from './agent/tokens.ts';
import { AppModule } from './app.module.ts';
import { EnvService } from './config/env.service.ts';

type Page = {
  conversations: { id: string; title?: string; updatedAt: string; messageCount: number }[];
  nextCursor: string | null;
};

/**
 * The real `AppModule` with its real `PostgresChatStore`: only the LLM provider, the env values
 * and the logger are replaced. `app.e2e.spec.ts` covers the HTTP behavior with the in-memory store
 * for speed; this file proves the same API works on Postgres, and that history survives a restart.
 */
describe('App on Postgres', () => {
  let database: TestDatabase;
  let app: INestApplication | undefined;
  let baseUrl: string;
  const logger = { setContext: vi.fn(), error: vi.fn() };

  /** Boots a server process against the shared database; closing it is the "restart". */
  async function boot(provider: FakeProvider) {
    const env: Record<string, unknown> = {
      NODE_ENV: 'test',
      PORT: 3000,
      LOG_LEVEL: 'silent',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11999',
      LLM_MODEL: 'test-model',
      AGENT_MAX_STEPS: 8,
      DATABASE_URL: database.url,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .overrideProvider(EnvService)
      .useValue({ get: (key: string) => env[key] })
      .overrideProvider(getLoggerToken(''))
      .useValue(logger)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }

  async function shutdown() {
    await app?.close();
    app = undefined;
  }

  async function createConversation(body: object = {}): Promise<string> {
    const res = await fetch(`${baseUrl}/v1/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function send(id: string, content: string) {
    const res = await fetch(`${baseUrl}/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    expect(res.status).toBe(200);
  }

  async function list(query = ''): Promise<Page> {
    const res = await fetch(`${baseUrl}/v1/conversations${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Page;
  }

  // Every test gets an empty database of its own, so counts and order are exact.
  beforeEach(async () => {
    database = await createTestDatabase(inject('databaseUrl'));
  });

  afterEach(async () => {
    await shutdown(); // closes the pool, which the drop needs
    await database.drop();
  });

  test('history survives a server restart and the model sees it when the conversation continues', async () => {
    await boot(new FakeProvider([textResponse('Noted: blue.')]));
    const id = await createConversation();
    await send(id, 'My favorite color is blue');
    await shutdown();

    const secondRun = new FakeProvider([textResponse('You told me your favorite color is blue.')]);
    await boot(secondRun);

    const history = await fetch(`${baseUrl}/v1/conversations/${id}/messages`);
    expect(((await history.json()) as { messages: object[] }).messages).toStrictEqual([
      { role: 'user', content: 'My favorite color is blue' },
      { role: 'assistant', content: 'Noted: blue.' },
    ]);

    await send(id, 'What did I just tell you?');

    const sent = secondRun.requests[0]?.messages.map((m) => [m.role, m.content]);
    expect(sent).toStrictEqual([
      ['system', expect.any(String)],
      ['user', 'My favorite color is blue'],
      ['assistant', 'Noted: blue.'],
      ['user', 'What did I just tell you?'],
    ]);
    expect((await list()).conversations).toMatchObject([{ id, messageCount: 4 }]);
  });

  test('25 conversations: limit=20 gives 20 and a cursor, the cursor gives 5 and null', async () => {
    await boot(new FakeProvider([]));
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await createConversation({ title: `conversation ${i}` }));

    const first = await list('?limit=20');
    const second = await list(`?limit=20&cursor=${encodeURIComponent(first.nextCursor ?? '')}`);

    expect(first.conversations).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.conversations).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect([...first.conversations, ...second.conversations].map((c) => c.id)).toStrictEqual(
      [...ids].reverse(),
    );
  });

  test('the conversation updated last is listed first, and the order survives a restart', async () => {
    await boot(new FakeProvider([textResponse('ok')]));
    const first = await createConversation();
    const second = await createConversation();
    await send(first, 'bump the first one');
    expect((await list()).conversations.map((c) => c.id)).toStrictEqual([first, second]);
    await shutdown();

    await boot(new FakeProvider([]));

    expect((await list()).conversations.map((c) => c.id)).toStrictEqual([first, second]);
  });

  test('a conversation opened without a title is titled from its first message', async () => {
    await boot(new FakeProvider([textResponse('ok')]));
    const id = await createConversation();

    await send(id, 'What time is it in Istanbul right now? Please answer in one short sentence.');

    const { conversations } = await list();
    expect(conversations).toMatchObject([
      { id, title: 'What time is it in Istanbul right now? Please answ', messageCount: 2 },
    ]);
    expect(conversations[0]?.title).toHaveLength(50);
  });

  test('an invalid cursor is a 400 invalid_cursor, not a database error', async () => {
    await boot(new FakeProvider([]));

    const res = await fetch(`${baseUrl}/v1/conversations?cursor=not-a-cursor`);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_cursor');
  });
});
