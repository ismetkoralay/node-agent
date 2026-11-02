import {
  type CallHandler,
  type ExecutionContext,
  StandardSchemaSerializerInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, test } from 'vitest';
import { ApiResult } from '../common/http.helpers.ts';
import {
  conversationListResponseSchema,
  conversationResponseSchema,
  messagesResponseSchema,
} from './chat.responses.ts';

class Handlers {
  @ApiResult(200, 'conversation', conversationResponseSchema)
  conversation() {}

  @ApiResult(200, 'messages', messagesResponseSchema)
  messages() {}

  @ApiResult(200, 'conversation list', conversationListResponseSchema)
  list() {}
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

  describe('conversation list', () => {
    const item = {
      id: crypto.randomUUID(),
      title: 'T',
      updatedAt: new Date('2026-10-29T10:42:21.427Z'),
      messageCount: 3,
    };

    test('turns each updatedAt into an ISO string and keeps nextCursor', async () => {
      expect(await serialize('list', { conversations: [item], nextCursor: 'abc' })).toStrictEqual({
        conversations: [{ ...item, updatedAt: '2026-10-29T10:42:21.427Z' }],
        nextCursor: 'abc',
      });
    });

    test('keeps a null nextCursor on the last page instead of dropping it', async () => {
      expect(await serialize('list', { conversations: [], nextCursor: null })).toStrictEqual({
        conversations: [],
        nextCursor: null,
      });
    });

    test('accepts an item without a title', async () => {
      const { title: _title, ...untitled } = item;

      const result = (await serialize('list', {
        conversations: [untitled],
        nextCursor: null,
      })) as { conversations: object[] };

      expect(result.conversations[0]).not.toHaveProperty('title');
    });

    test('drops fields that are not in the schema', async () => {
      const result = (await serialize('list', {
        conversations: [{ ...item, metadata: { secret: 'x' } }],
        nextCursor: null,
      })) as { conversations: object[] };

      expect(result.conversations[0]).not.toHaveProperty('metadata');
    });

    test.each([
      ['a missing nextCursor', { conversations: [] }],
      [
        'a missing messageCount',
        { conversations: [{ ...item, messageCount: undefined }], nextCursor: null },
      ],
      [
        'a fractional messageCount',
        { conversations: [{ ...item, messageCount: 1.5 }], nextCursor: null },
      ],
      ['an id that is not a uuid', { conversations: [{ ...item, id: 'abc' }], nextCursor: null }],
      [
        'an updatedAt that is a string',
        { conversations: [{ ...item, updatedAt: '2026-10-29T10:42:21.427Z' }], nextCursor: null },
      ],
    ])('rejects %s', async (_name, value) => {
      await expect(serialize('list', value)).rejects.toThrow(/Serialization failed/);
    });
  });
});
