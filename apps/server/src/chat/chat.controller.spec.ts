import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createAgent, InMemoryChatStore } from '@node-agent/core';
import { FakeProvider, textResponse, toolCallResponse } from '@node-agent/core/testing';
import { getCurrentTimeTool } from '@node-agent/tools';
import { LoggerModule } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AGENT, CHAT_STORE } from '../agent/tokens.ts';
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
  let app: INestApplication;
  let store: InMemoryChatStore;
  let baseUrl: string;

  async function start(provider: FakeProvider) {
    store = new InMemoryChatStore();
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

  beforeEach(async () => {
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
