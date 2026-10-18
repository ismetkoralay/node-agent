import { beforeEach, describe, expect, test } from 'vitest';
import { ConversationNotFoundError } from '../errors/index.ts';
import type { ChatStore } from '../memory/index.ts';
import type { Message } from '../types/message.ts';

/**
 * Registers the behavior every `ChatStore` must have, so each implementation (in-memory,
 * Postgres) is held to one definition. Call it from an implementation's own test file; it is not
 * a test file itself. Only the `ChatStore` interface is used, never an implementation's internals.
 */
export function describeChatStore(
  name: string,
  createStore: () => ChatStore | Promise<ChatStore>,
): void {
  describe(`${name} (ChatStore contract)`, () => {
    let store: ChatStore;

    beforeEach(async () => {
      store = await createStore();
    });

    test('a new conversation has no messages', async () => {
      const { id } = await store.createConversation();

      expect(await store.getMessages(id)).toEqual([]);
    });

    test('createConversation keeps the given title and metadata', async () => {
      const created = await store.createConversation({ title: 'new conv', metadata: { a: 'b' } });

      expect(created.id).toBeTypeOf('string');
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.title).toBe('new conv');
      expect(created.metadata).toEqual({ a: 'b' });
    });

    test('metadata defaults to an empty object', async () => {
      const created = await store.createConversation();

      expect(created.title).toBeUndefined();
      expect(created.metadata).toEqual({});
    });

    test('getConversation returns the created conversation', async () => {
      const created = await store.createConversation({ title: 'new conv', metadata: { a: 'b' } });

      expect(await store.getConversation(created.id)).toEqual(created);
    });

    test('getConversation returns null for an unknown id', async () => {
      expect(await store.getConversation(crypto.randomUUID())).toBeNull();
    });

    test('conversations get distinct ids and separate histories', async () => {
      const first = await store.createConversation();
      const second = await store.createConversation();
      await store.appendMessages(first.id, [{ role: 'user', content: 'only in first' }]);

      expect(second.id).not.toBe(first.id);
      expect(await store.getMessages(second.id)).toEqual([]);
    });

    test('appended messages come back in the order they were appended', async () => {
      const { id } = await store.createConversation();
      await store.appendMessages(id, [
        { role: 'user', content: 'user-message' },
        { role: 'assistant', content: 'assistant-message' },
      ]);

      expect(await store.getMessages(id)).toEqual([
        { role: 'user', content: 'user-message' },
        { role: 'assistant', content: 'assistant-message' },
      ]);
    });

    test('two consecutive appends are concatenated in order', async () => {
      const { id } = await store.createConversation();
      await store.appendMessages(id, [{ role: 'user', content: 'user-message' }]);
      await store.appendMessages(id, [{ role: 'assistant', content: 'assistant-message' }]);

      expect(await store.getMessages(id)).toEqual([
        { role: 'user', content: 'user-message' },
        { role: 'assistant', content: 'assistant-message' },
      ]);
    });

    test('tool calls and tool results come back with every field intact', async () => {
      const { id } = await store.createConversation();
      const messages: Message[] = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tool-call-1',
              type: 'function',
              function: { name: 'function-1', arguments: '{"a":"b"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'tool-call-1', content: 'result' },
      ];
      await store.appendMessages(id, messages);

      expect(await store.getMessages(id)).toEqual(messages);
    });

    test('appending to an unknown conversation throws ConversationNotFoundError', async () => {
      const conversationId = crypto.randomUUID();
      const err = await store
        .appendMessages(conversationId, [{ role: 'user', content: 'hi' }])
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConversationNotFoundError);
      expect(err).toMatchObject({ code: 'conversation_not_found', conversationId: conversationId });
      expect((err as Error).message).toContain(conversationId);
    });

    test('reading messages of an unknown conversation throws ConversationNotFoundError', async () => {
      const conversationId = crypto.randomUUID();
      const err = await store.getMessages(conversationId).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConversationNotFoundError);
      expect(err).toMatchObject({ code: 'conversation_not_found', conversationId: conversationId });
      expect((err as Error).message).toContain(conversationId);
    });

    test('mutating the array returned by getMessages does not change the stored history', async () => {
      const { id } = await store.createConversation();
      await store.appendMessages(id, [{ role: 'user', content: 'original' }]);

      const returned = await store.getMessages(id);
      returned.push({ role: 'user', content: 'hack' });
      const first = returned[0];
      if (first) first.content = 'changed';

      expect(await store.getMessages(id)).toEqual([{ role: 'user', content: 'original' }]);
    });

    test('mutating a message after appendMessages does not change the stored history', async () => {
      const { id } = await store.createConversation();
      const message: Message = { role: 'user', content: 'original' };
      await store.appendMessages(id, [message]);

      message.content = 'changed';

      expect(await store.getMessages(id)).toEqual([{ role: 'user', content: 'original' }]);
    });

    test('mutating the metadata passed to createConversation does not change the stored one', async () => {
      const metadata = { a: 'b' };
      const { id } = await store.createConversation({ metadata });

      metadata.a = 'changed';

      expect(await store.getConversation(id)).toMatchObject({ metadata: { a: 'b' } });
    });

    test('mutating a returned conversation does not change the stored one', async () => {
      const created = await store.createConversation({ title: 'title', metadata: { a: 'b' } });

      created.metadata.a = 'changed';
      created.title = 'changed';
      const fetched = await store.getConversation(created.id);
      if (fetched) fetched.metadata.a = 'changed again';

      expect(await store.getConversation(created.id)).toMatchObject({
        title: 'title',
        metadata: { a: 'b' },
      });
    });
  });
}
