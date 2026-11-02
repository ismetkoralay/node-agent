import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { InMemoryChatStore, ProviderError } from '@node-agent/core';
import { FakeProvider, textResponse, toolCallResponse } from '@node-agent/core/testing';
import { getLoggerToken } from 'nestjs-pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { CHAT_STORE, LLM_PROVIDER } from './agent/tokens.ts';
import { AppModule } from './app.module.ts';
import {
  conversationResponseSchema,
  messagesResponseSchema,
  sendMessageResponseSchema,
} from './chat/chat.responses.ts';
import { ChatService } from './chat/chat.service.ts';
import { EnvService } from './config/env.service.ts';
import { setupSwagger } from './swagger.ts';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: { path: string; message: string }[];
  };
};

/**
 * Drives the real `AppModule` over HTTP, so the real `APP_FILTER`, `APP_INTERCEPTOR`, pino's
 * `genReqId`, body-parser and Swagger are all in play. Only the LLM provider, the env values and
 * the logger are replaced (and, in a few tests, `ChatService`).
 */
describe('App', () => {
  let app: INestApplication;
  let baseUrl: string;
  const logger = { setContext: vi.fn(), error: vi.fn() };

  async function start(
    provider: FakeProvider,
    override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
  ) {
    const env: Record<string, unknown> = {
      NODE_ENV: 'test',
      PORT: 3000,
      LOG_LEVEL: 'silent',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11999',
      LLM_MODEL: 'test-model',
      AGENT_MAX_STEPS: 8,
    };
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .overrideProvider(EnvService)
      .useValue({ get: (key: string) => env[key] })
      .overrideProvider(getLoggerToken(''))
      .useValue(logger)
      .overrideProvider(CHAT_STORE)
      .useValue(new InMemoryChatStore());
    const moduleRef = await override(builder).compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }

  afterEach(async () => {
    await app.close();
    logger.error.mockClear();
  });

  async function createConversation(): Promise<string> {
    const res = await fetch(`${baseUrl}/v1/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return ((await res.json()) as { id: string }).id;
  }

  function send(id: string, content = 'hello', headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ content }),
    });
  }

  async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
    const body = (await res.json()) as ErrorBody;
    expect(res.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.requestId).not.toBe('undefined');
    expect(res.headers.get('x-request-id')).toBe(body.error.requestId);
    return body;
  }

  async function history(id: string): Promise<(string | null | undefined)[]> {
    const res = await fetch(`${baseUrl}/v1/conversations/${id}/messages`);
    const { messages } = (await res.json()) as { messages: { content?: string | null }[] };
    return messages.map((m) => m.content);
  }

  describe('validation', () => {
    test('returns every Zod issue with its path', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { a: 1 }, title: 5 }),
      });

      const body = await expectError(res, 400, 'validation_error');
      expect(body.error.message).toBe('Request validation failed');
      expect(body.error.details?.map((d) => d.path).sort()).toStrictEqual(['metadata.a', 'title']);
      expect(body.error.details?.every((d) => d.message.length > 0)).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('a missing content field is a validation_error on the content path', async () => {
      await start(new FakeProvider([]));
      const id = await createConversation();

      const res = await fetch(`${baseUrl}/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      const body = await expectError(res, 400, 'validation_error');
      expect(body.error.details).toMatchObject([{ path: 'content' }]);
    });

    test('an invalid uuid is a validation_error on the id path', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations/abc`);

      const body = await expectError(res, 400, 'validation_error');
      expect(body.error.details).toStrictEqual([{ path: 'id', message: 'Invalid UUID' }]);
    });
  });

  describe('body parsing', () => {
    test('malformed JSON returns 400 bad_request with a filled requestId', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad json',
      });

      await expectError(res, 400, 'bad_request');
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('a body over 100kb returns 413 payload_too_large with a filled requestId', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'a'.repeat(200 * 1024) }),
      });

      const body = await expectError(res, 413, 'payload_too_large');
      expect(body.error.message).toBe('request entity too large');
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('not found', () => {
    test('an unknown conversation returns 404 conversation_not_found', async () => {
      await start(new FakeProvider([]));
      const id = crypto.randomUUID();

      const res = await send(id);

      const body = await expectError(res, 404, 'conversation_not_found');
      expect(body.error.message).toContain(id);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('reading the messages of an unknown conversation returns 404 conversation_not_found', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations/${crypto.randomUUID()}/messages`);

      await expectError(res, 404, 'conversation_not_found');
    });

    test('an unknown route returns 404 not_found', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/nope`);

      const body = await expectError(res, 404, 'not_found');
      expect(body.error.message).toBe('Cannot GET /nope');
    });

    test('an unsupported method returns 404 not_found', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations`, { method: 'DELETE' });

      await expectError(res, 404, 'not_found');
    });
  });

  describe('request id', () => {
    test('uses the incoming x-request-id in the body and the header', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations/abc`, {
        headers: { 'x-request-id': 'my-id' },
      });

      const body = await expectError(res, 400, 'validation_error');
      expect(body.error.requestId).toBe('my-id');
    });

    test('generates one when the client sends none', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations/abc`);

      const body = await expectError(res, 400, 'validation_error');
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('server errors', () => {
    test('a ProviderError returns 502 provider_unavailable and shows nothing internal', async () => {
      const providerError = new ProviderError('Could not reach Ollama: fetch failed', {
        provider: 'ollama',
        retryable: true,
        cause: new Error('connect ECONNREFUSED 127.0.0.1:11999'),
      });
      await start(new FakeProvider([providerError]));
      const id = await createConversation();

      const res = await send(id);

      const text = JSON.stringify(await res.clone().json());
      const body = await expectError(res, 502, 'provider_unavailable');
      expect(body.error.message).toBe('The language model is unavailable, try again later');
      expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|fetch failed|stack/);
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error.mock.calls[0]?.[0]).toStrictEqual({ err: providerError });
    });

    test('an unknown error returns 500 internal_error without its message, and logs it', async () => {
      const secret = new Error('secret');
      await start(new FakeProvider([secret]));
      const id = await createConversation();

      const res = await send(id);

      const text = JSON.stringify(await res.clone().json());
      const body = await expectError(res, 500, 'internal_error');
      expect(body.error.message).toBe('Internal server error');
      expect(text).not.toContain('secret');
      expect(logger.error.mock.calls[0]?.[0]).toStrictEqual({ err: secret });
    });

    test('a failed run releases the lock and leaves nothing in the history', async () => {
      await start(
        new FakeProvider([
          new ProviderError('down', { provider: 'ollama', retryable: true }),
          textResponse('ok'),
        ]),
      );
      const id = await createConversation();

      const failed = await send(id, 'first');
      const succeeded = await send(id, 'second');

      expect(failed.status).toBe(502);
      expect(succeeded.status).toBe(200);
      expect(await history(id)).toStrictEqual(['second', 'ok']);
    });
  });

  describe('conversation lock', () => {
    test('two simultaneous messages to one conversation: one 200, one 409', async () => {
      await start(new FakeProvider([textResponse('one'), textResponse('two')], { delayMs: 300 }));
      const id = await createConversation();

      const responses = await Promise.all([send(id, 'first'), send(id, 'second')]);

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toStrictEqual([200, 409]);
      const busy = responses.find((r) => r.status === 409);
      if (!busy) throw new Error('no 409 response');
      const body = await expectError(busy, 409, 'conversation_busy');
      expect(body.error.message).toContain(id);
      expect(logger.error).not.toHaveBeenCalled();
      expect(await history(id)).toHaveLength(2);
    });

    test('a 409 does not unlock the running request: the third message is rejected too', async () => {
      const provider = new FakeProvider([textResponse('one'), textResponse('two')], {
        delayMs: 300,
      });
      await start(provider);
      const id = await createConversation();

      const first = send(id, 'first');
      // Once the provider has been called, the first run is inside the lock.
      await vi.waitFor(() => expect(provider.requests).toHaveLength(1));
      const second = await send(id, 'second');
      const third = await send(id, 'third');

      expect(second.status).toBe(409);
      expect(third.status).toBe(409);
      expect((await first).status).toBe(200);
      expect(provider.requests).toHaveLength(1);
    });

    test('the lock is free again after the run finishes', async () => {
      await start(new FakeProvider([textResponse('one'), textResponse('two')]));
      const id = await createConversation();

      const first = await send(id, 'first');
      const second = await send(id, 'second');

      expect([first.status, second.status]).toStrictEqual([200, 200]);
      expect(await history(id)).toStrictEqual(['first', 'one', 'second', 'two']);
    });
  });

  describe('happy path', () => {
    async function createWith(body: unknown): Promise<Response> {
      return fetch(`${baseUrl}/v1/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    test('creating a conversation returns 201 with an ISO createdAt, the title and the metadata', async () => {
      await start(new FakeProvider([]));

      const res = await createWith({ title: 'Current Time', metadata: { timezone: 'UTC' } });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        title: string;
        metadata: Record<string, string>;
        createdAt: string;
      };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.title).toBe('Current Time');
      expect(body.metadata).toStrictEqual({ timezone: 'UTC' });
      expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    });

    test('a conversation created without a body has empty metadata and no title', async () => {
      await start(new FakeProvider([]));

      const res = await fetch(`${baseUrl}/v1/conversations`, { method: 'POST' });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.metadata).toStrictEqual({});
      expect(body).not.toHaveProperty('title');
    });

    test('GET /:id returns the same shape as the create response', async () => {
      await start(new FakeProvider([]));
      const created = await (await createWith({ title: 'T', metadata: { a: 'b' } })).json();

      const res = await fetch(`${baseUrl}/v1/conversations/${(created as { id: string }).id}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual(created);
    });

    test('a message that needs a tool runs two steps and the history keeps the tool exchange', async () => {
      await start(
        new FakeProvider([
          toolCallResponse([{ name: 'get_current_time', args: { timezone: 'Europe/Istanbul' } }]),
          textResponse('It is evening in Istanbul.'),
        ]),
      );
      const id = await createConversation();

      const res = await send(id, 'What time is it in Istanbul?');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        message: { content: string };
        steps: number;
        finishReason: string;
      };
      expect(body.steps).toBe(2);
      expect(body.finishReason).toBe('stop');
      expect(body.message.content).toBe('It is evening in Istanbul.');

      const history = (await (
        await fetch(`${baseUrl}/v1/conversations/${id}/messages`)
      ).json()) as {
        messages: {
          role: string;
          content: string | null;
          tool_calls?: { id: string; function: { name: string } }[];
          tool_call_id?: string;
        }[];
      };
      const [user, assistantCall, tool, assistantAnswer] = history.messages;
      expect(history.messages.map((m) => m.role)).toStrictEqual([
        'user',
        'assistant',
        'tool',
        'assistant',
      ]);
      expect(user?.content).toBe('What time is it in Istanbul?');
      expect(assistantCall?.content).toBeNull();
      expect(assistantCall?.tool_calls).toHaveLength(1);
      expect(assistantCall?.tool_calls?.[0]?.function.name).toBe('get_current_time');
      expect(tool?.tool_call_id).toBe(assistantCall?.tool_calls?.[0]?.id);
      const toolResult = JSON.parse(tool?.content ?? '') as { timezone: string; iso: string };
      expect(toolResult.timezone).toBe('Europe/Istanbul');
      expect(Math.abs(Date.parse(toolResult.iso) - Date.now())).toBeLessThan(60_000);
      expect(assistantAnswer?.content).toBe('It is evening in Istanbul.');
    });
  });

  describe('list conversations', () => {
    type Page = {
      conversations: { id: string; title?: string; updatedAt: string; messageCount: number }[];
      nextCursor: string | null;
    };

    async function list(query = ''): Promise<Response> {
      return fetch(`${baseUrl}/v1/conversations${query}`);
    }

    /** Creates `count` conversations one after another, so the last one is the newest. */
    async function createMany(count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) ids.push(await createConversation());
      return ids;
    }

    test('an empty server lists nothing', async () => {
      await start(new FakeProvider([]));

      const res = await list();

      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ conversations: [], nextCursor: null });
    });

    test('lists the conversation that was updated last first, with its title and message count', async () => {
      await start(new FakeProvider([textResponse('hi there')]));
      const [older, newer] = await createMany(2);

      await send(older as string, 'Tell me a joke about databases');

      const page = (await (await list()).json()) as Page;
      expect(page.conversations.map((c) => c.id)).toStrictEqual([older, newer]);
      expect(page.conversations[0]).toStrictEqual({
        id: older,
        title: 'Tell me a joke about databases',
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        messageCount: 2,
      });
      expect(page.conversations[1]).toMatchObject({ id: newer, messageCount: 0 });
      expect(page.conversations[1]).not.toHaveProperty('title');
    });

    test('with 25 conversations, limit=20 gives 20 and a cursor, and the cursor gives 5 and null', async () => {
      await start(new FakeProvider([]));
      const ids = await createMany(25);

      const first = (await (await list('?limit=20')).json()) as Page;
      const second = (await (
        await list(`?limit=20&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
      ).json()) as Page;

      expect(first.conversations).toHaveLength(20);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(second.conversations).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      expect([...first.conversations, ...second.conversations].map((c) => c.id)).toStrictEqual(
        [...ids].reverse(),
      );
    });

    test('a conversation created without a title is titled from its first message', async () => {
      await start(new FakeProvider([textResponse('ok')]));
      const id = await createConversation();

      await send(id, `  ${'word '.repeat(30)}`);

      const { conversations } = (await (await list()).json()) as Page;
      expect(conversations[0]?.title).toBe(`${'word '.repeat(10)}`.trim());
      expect(conversations[0]?.title).toHaveLength(49);
    });

    test('a title given at creation is not replaced by the first message', async () => {
      await start(new FakeProvider([textResponse('ok')]));
      const created = await fetch(`${baseUrl}/v1/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Mine' }),
      });
      const { id } = (await created.json()) as { id: string };

      await send(id, 'something else');

      const { conversations } = (await (await list()).json()) as Page;
      expect(conversations[0]?.title).toBe('Mine');
    });

    test.each([
      ['limit=0', 'limit'],
      ['limit=101', 'limit'],
      ['limit=abc', 'limit'],
      ['cursor=', 'cursor'],
    ])('?%s is a validation_error on the %s path', async (query, path) => {
      await start(new FakeProvider([]));

      const body = await expectError(await list(`?${query}`), 400, 'validation_error');

      expect(body.error.details).toMatchObject([{ path }]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('a cursor the server did not issue is an invalid_cursor error, not a 500', async () => {
      await start(new FakeProvider([]));

      await expectError(await list('?cursor=not-a-cursor'), 400, 'invalid_cursor');

      expect(logger.error).not.toHaveBeenCalled();
    });

    test('a request id header is set on the response', async () => {
      await start(new FakeProvider([]));

      const res = await list();

      expect(res.headers.get('x-request-id')).toEqual(expect.any(String));
    });
  });

  describe('serializer', () => {
    test('every happy path response parses with its own response schema', async () => {
      await start(new FakeProvider([textResponse('hi')]));
      const created = await (
        await fetch(`${baseUrl}/v1/conversations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'T' }),
        })
      ).json();
      const { id } = created as { id: string };

      const fetched = await (await fetch(`${baseUrl}/v1/conversations/${id}`)).json();
      const sent = await (await send(id)).json();
      const messages = await (await fetch(`${baseUrl}/v1/conversations/${id}/messages`)).json();

      // The schema's forward direction takes the service's `Date`; `z.encode` checks the wire shape.
      expect(() => z.encode(conversationResponseSchema, created as never)).not.toThrow();
      expect(() => z.encode(conversationResponseSchema, fetched as never)).not.toThrow();
      expect(sendMessageResponseSchema.parse(sent)).toStrictEqual(sent);
      expect(messagesResponseSchema.parse(messages)).toStrictEqual(messages);
    });

    test('a response that does not match its schema is a 500 internal_error and is logged', async () => {
      await start(new FakeProvider([]), (b) =>
        b.overrideProvider(ChatService).useValue({
          getConversation: async () => ({ id: 'not-a-uuid', metadata: {}, createdAt: new Date() }),
        }),
      );

      const res = await fetch(`${baseUrl}/v1/conversations/${crypto.randomUUID()}`);

      const body = await expectError(res, 500, 'internal_error');
      expect(body.error.message).toBe('Internal server error');
      expect(logger.error).toHaveBeenCalledOnce();
    });

    test('fields that are not in the schema are removed from the response', async () => {
      await start(new FakeProvider([]), (b) =>
        b.overrideProvider(ChatService).useValue({
          getConversation: async () => ({
            id: crypto.randomUUID(),
            metadata: {},
            createdAt: new Date(),
            internalNote: 'must not leak',
          }),
        }),
      );

      const res = await fetch(`${baseUrl}/v1/conversations/${crypto.randomUUID()}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).not.toContain('internalNote');
    });
  });

  describe('swagger', () => {
    type Operation = {
      parameters?: {
        name: string;
        in?: string;
        required?: boolean;
        schema?: {
          format?: string;
          type?: string;
          minimum?: number;
          maximum?: number;
          default?: number;
        };
      }[];
      requestBody?: { required?: boolean; content: Record<string, { schema: unknown }> };
      responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
    };
    type Doc = {
      paths: Record<string, Record<string, Operation>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    async function openApi(): Promise<Doc> {
      await start(new FakeProvider([]));
      return (await (await fetch(`${baseUrl}/docs-json`)).json()) as Doc;
    }

    /** Follows a `$ref` into `components.schemas`; inline schemas are returned as they are. */
    function resolve(doc: Doc, schema: unknown): Record<string, unknown> {
      const ref = (schema as { $ref?: string }).$ref;
      if (!ref) return schema as Record<string, unknown>;
      const resolved = doc.components.schemas[ref.replace('#/components/schemas/', '')];
      if (!resolved) throw new Error(`unresolved ${ref}`);
      return resolved;
    }

    function jsonSchema(doc: Doc, response: Operation['responses'][string]) {
      const schema = response.content?.['application/json']?.schema;
      if (!schema) throw new Error('no application/json schema');
      return resolve(doc, schema);
    }

    test('the UI is served at /docs and the OpenAPI JSON at /docs-json', async () => {
      await start(new FakeProvider([]));

      const ui = await fetch(`${baseUrl}/docs`);
      const json = await fetch(`${baseUrl}/docs-json`);

      expect(ui.status).toBe(200);
      expect(await ui.text()).toContain('swagger');
      expect(json.status).toBe(200);
    });

    test('documents the five endpoints', async () => {
      const doc = await openApi();

      const operations = Object.entries(doc.paths)
        .filter(([path]) => path.startsWith('/v1/conversations'))
        .flatMap(([path, item]) => Object.keys(item).map((m) => `${m.toUpperCase()} ${path}`));
      expect(operations.sort()).toStrictEqual(
        [
          'GET /v1/conversations/{id}',
          'GET /v1/conversations/{id}/messages',
          'POST /v1/conversations',
          'POST /v1/conversations/{id}/messages',
          'GET /v1/conversations',
        ].sort(),
      );
    });

    test('the send message body documents the content length limits', async () => {
      const doc = await openApi();

      const op = doc.paths['/v1/conversations/{id}/messages']?.post;
      const body = resolve(doc, op?.requestBody?.content['application/json']?.schema);
      expect(op?.requestBody?.required).toBe(true);
      expect(body.properties).toMatchObject({ content: { minLength: 1, maxLength: 8000 } });
      expect(body.example).toStrictEqual({ content: 'What time is it in Istanbul?' });
    });

    test('the create conversation body is optional', async () => {
      const doc = await openApi();

      const op = doc.paths['/v1/conversations']?.post;
      expect(op?.requestBody?.required).toBe(false);
      expect(
        resolve(doc, op?.requestBody?.content['application/json']?.schema).properties,
      ).toHaveProperty('title');
    });

    test('the id parameter is documented as a uuid', async () => {
      const doc = await openApi();

      const op = doc.paths['/v1/conversations/{id}']?.get;
      expect(op?.parameters?.find((p) => p.name === 'id')?.schema?.format).toBe('uuid');
    });

    test('the list endpoint documents limit and cursor as optional query parameters', async () => {
      const doc = await openApi();

      const parameters = doc.paths['/v1/conversations']?.get?.parameters ?? [];
      const limit = parameters.find((p) => p.name === 'limit');
      const cursor = parameters.find((p) => p.name === 'cursor');
      expect(limit).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      });
      expect(cursor).toMatchObject({ in: 'query', required: false, schema: { type: 'string' } });
    });

    test('the list response documents a nullable nextCursor and date-time updatedAt', async () => {
      const doc = await openApi();

      const response = doc.paths['/v1/conversations']?.get?.responses['200'];
      if (!response) throw new Error('no 200 response documented');
      const schema = jsonSchema(doc, response) as {
        properties: { conversations: { items: unknown }; nextCursor: unknown };
        required: string[];
      };
      const item = resolve(doc, schema.properties.conversations.items) as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(JSON.stringify(schema.properties.nextCursor)).toContain('null');
      expect(schema.required).toContain('nextCursor');
      expect(item.properties).toMatchObject({ updatedAt: { type: 'string', format: 'date-time' } });
      expect(Object.keys(item.properties).sort()).toStrictEqual([
        'id',
        'messageCount',
        'title',
        'updatedAt',
      ]);
      expect(item.required).not.toContain('title');
    });

    test('send message documents 400, 404, 409 and 502 with the error envelope', async () => {
      const doc = await openApi();

      const responses = doc.paths['/v1/conversations/{id}/messages']?.post?.responses ?? {};
      for (const status of ['400', '404', '409', '502']) {
        const response = responses[status];
        if (!response) throw new Error(`no ${status} response documented`);
        const schema = jsonSchema(doc, response) as {
          properties: { error: { properties: Record<string, unknown> } };
        };
        expect(Object.keys(schema.properties.error.properties), status).toEqual(
          expect.arrayContaining(['code', 'message', 'requestId']),
        );
      }
    });

    test('every endpoint documents 400, and the id endpoints document 404', async () => {
      const doc = await openApi();

      const chatPaths = Object.entries(doc.paths).filter(([p]) =>
        p.startsWith('/v1/conversations'),
      );
      for (const [path, item] of chatPaths) {
        for (const [method, op] of Object.entries(item)) {
          expect(op.responses, `${method} ${path}`).toHaveProperty('400');
          if (path.includes('{id}'))
            expect(op.responses, `${method} ${path}`).toHaveProperty('404');
        }
      }
    });

    test('createdAt is a date-time string', async () => {
      const doc = await openApi();

      const response = doc.paths['/v1/conversations']?.post?.responses['201'];
      if (!response) throw new Error('no 201 response documented');
      expect(jsonSchema(doc, response).properties).toMatchObject({
        createdAt: { type: 'string', format: 'date-time' },
      });
    });
  });
});
