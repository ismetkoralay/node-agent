import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProviderError } from '@node-agent/core';
import { FakeProvider, textResponse } from '@node-agent/core/testing';
import { getLoggerToken } from 'nestjs-pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LLM_PROVIDER } from './agent/tokens.ts';
import { AppModule } from './app.module.ts';
import { EnvService } from './config/env.service.ts';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: { path: string; message: string }[];
  };
};

/**
 * Drives the real `AppModule` over HTTP, so the real `APP_FILTER`, pino's `genReqId` and
 * body-parser are all in play. Only the LLM provider, the env values and the logger are replaced.
 */
describe('App (error handling and conversation lock)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const logger = { setContext: vi.fn(), error: vi.fn() };

  async function start(provider: FakeProvider) {
    const env: Record<string, unknown> = {
      NODE_ENV: 'test',
      PORT: 3000,
      LOG_LEVEL: 'silent',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11999',
      LLM_MODEL: 'test-model',
      AGENT_MAX_STEPS: 8,
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
});
