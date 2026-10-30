import {
  type CallHandler,
  type ExecutionContext,
  StandardSchemaSerializerInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, test } from 'vitest';
import { ApiResult } from '../common/http.helpers.ts';
import { conversationResponseSchema, messagesResponseSchema } from './chat.responses.ts';

class Handlers {
  @ApiResult(200, 'conversation', conversationResponseSchema)
  conversation() {}

  @ApiResult(200, 'messages', messagesResponseSchema)
  messages() {}
}

/** Runs `value` through the global interceptor as if `handler` had returned it. */
function serialize(handler: keyof Handlers, value: unknown): Promise<unknown> {
  const interceptor = new StandardSchemaSerializerInterceptor(new Reflector());
  const context = {
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(value) };
  return lastValueFrom(interceptor.intercept(context, next));
}

describe('response serialization with the response schemas', () => {
  const conversation = {
    id: crypto.randomUUID(),
    title: 'T',
    metadata: { a: 'b' },
    createdAt: new Date('2026-10-29T10:42:21.427Z'),
  };

  test('turns the Date into an ISO string', async () => {
    expect(await serialize('conversation', conversation)).toStrictEqual({
      ...conversation,
      createdAt: '2026-10-29T10:42:21.427Z',
    });
  });

  test('drops fields that are not in the schema', async () => {
    const result = await serialize('conversation', { ...conversation, internalNote: 'secret' });

    expect(result).not.toHaveProperty('internalNote');
  });

  test.each([
    ['an id that is not a uuid', { ...conversation, id: 'abc' }],
    ['a missing createdAt', { ...conversation, createdAt: undefined }],
    ['a createdAt that is a string', { ...conversation, createdAt: '2026-10-29T10:42:21.427Z' }],
    ['metadata with a non-string value', { ...conversation, metadata: { a: 1 } }],
  ])('rejects %s', async (_name, value) => {
    await expect(serialize('conversation', value)).rejects.toThrow(/Serialization failed/);
  });

  test('keeps an assistant message with null content and tool calls, and a tool message with empty content', async () => {
    const body = {
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 't', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '' },
      ],
    };

    expect(await serialize('messages', body)).toStrictEqual(body);
  });

  test('rejects a message with an unknown role', async () => {
    await expect(
      serialize('messages', { messages: [{ role: 'robot', content: 'x' }] }),
    ).rejects.toThrow(/Serialization failed/);
  });
});
