import { beforeEach, describe, expect, test } from 'vitest';
import { ConversationNotFoundError, InvalidCursorError } from '../errors/index.ts';
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
    describe('listConversations', () => {
      /** Creates `count` conversations one after another, so the last one is the newest. */
      async function createMany(count: number): Promise<string[]> {
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          ids.push((await store.createConversation({ title: `conv ${i}` })).id);
        }
        return ids;
      }

      /** Follows `nextCursor` until it is `null`, returning every page. */
      async function allPages(limit: number) {
        const pages = [];
        let cursor: string | undefined;
        do {
          const page = await store.listConversations(limit, cursor);
          pages.push(page);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return pages;
      }

      test('an empty store lists nothing and has no next page', async () => {
        expect(await store.listConversations(10)).toEqual({ conversations: [], nextCursor: null });
      });

      test('each entry has id, title, updatedAt and messageCount', async () => {
        const { id } = await store.createConversation({ title: 'with title' });
        await store.appendMessages(id, [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ]);

        const { conversations } = await store.listConversations(10);

        expect(conversations).toEqual([
          { id, title: 'with title', updatedAt: expect.any(Date), messageCount: 2 },
        ]);
      });

      test('a conversation without messages or title has messageCount 0 and no title', async () => {
        const { id } = await store.createConversation();

        const { conversations } = await store.listConversations(10);

        expect(conversations).toHaveLength(1);
        expect(conversations[0]).toMatchObject({ id, messageCount: 0 });
        expect(conversations[0]?.title).toBeUndefined();
      });

      test('messageCount counts every role and only the conversation own messages', async () => {
        const first = await store.createConversation();
        const second = await store.createConversation();
        await store.appendMessages(first.id, [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } }],
          },
          { role: 'tool', tool_call_id: 't1', content: 'r' },
          { role: 'assistant', content: 'a' },
        ]);
        await store.appendMessages(second.id, [{ role: 'user', content: 'other' }]);

        const { conversations } = await store.listConversations(10);

        const counts = Object.fromEntries(conversations.map((c) => [c.id, c.messageCount]));
        expect(counts).toEqual({ [first.id]: 4, [second.id]: 1 });
      });

      test('lists the most recently updated conversation first', async () => {
        const [a, b, c] = await createMany(3);
        if (!(a && b && c)) throw new Error('unreachable');

        expect((await store.listConversations(10)).conversations.map((x) => x.id)).toEqual([
          c,
          b,
          a,
        ]);

        await store.appendMessages(a, [{ role: 'user', content: 'bump' }]);

        expect((await store.listConversations(10)).conversations.map((x) => x.id)).toEqual([
          a,
          c,
          b,
        ]);
      });

      test('appending messages moves updatedAt forward, never back', async () => {
        const { id } = await store.createConversation();
        const before = (await store.listConversations(10)).conversations[0]?.updatedAt;

        await store.appendMessages(id, [{ role: 'user', content: 'hi' }]);
        const after = (await store.listConversations(10)).conversations[0]?.updatedAt;

        expect(after).toBeInstanceOf(Date);
        expect((after as Date).getTime()).toBeGreaterThanOrEqual((before as Date).getTime());
      });

      test('splits 25 conversations into 20 and 5, newest first, with no gap or repeat', async () => {
        const ids = await createMany(25);

        const [first, second, ...rest] = await allPages(20);

        expect(first?.conversations).toHaveLength(20);
        expect(first?.nextCursor).toEqual(expect.any(String));
        expect(second?.conversations).toHaveLength(5);
        expect(second?.nextCursor).toBeNull();
        expect(rest).toEqual([]);
        const listed = [...(first?.conversations ?? []), ...(second?.conversations ?? [])];
        expect(listed.map((c) => c.id)).toEqual([...ids].reverse());
      });

      test('has no trailing empty page when the count is a multiple of the limit', async () => {
        await createMany(4);

        const pages = await allPages(2);

        expect(pages.map((p) => p.conversations.length)).toEqual([2, 2]);
        expect(pages.map((p) => p.nextCursor === null)).toEqual([false, true]);
      });

      test('a limit larger than the number of conversations returns all of them', async () => {
        await createMany(3);

        const page = await store.listConversations(100);

        expect(page.conversations).toHaveLength(3);
        expect(page.nextCursor).toBeNull();
      });

      test('a limit of 1 walks one conversation at a time', async () => {
        const ids = await createMany(3);

        const pages = await allPages(1);

        expect(pages.map((p) => p.conversations[0]?.id)).toEqual([...ids].reverse());
      });

      test('new activity between two requests neither repeats nor skips an older conversation', async () => {
        const ids = await createMany(5); // newest first: 4 3 2 1 0
        const first = await store.listConversations(2);
        expect(first.conversations.map((c) => c.id)).toEqual([ids[4], ids[3]]);

        await store.createConversation({ title: 'arrived meanwhile' });
        await store.appendMessages(ids[3] as string, [{ role: 'user', content: 'bump' }]);
        const second = await store.listConversations(2, first.nextCursor ?? undefined);

        expect(second.conversations.map((c) => c.id)).toEqual([ids[2], ids[1]]);
        const third = await store.listConversations(2, second.nextCursor ?? undefined);
        expect(third.conversations.map((c) => c.id)).toEqual([ids[0]]);
        expect(third.nextCursor).toBeNull();
      });

      test.each(['not-a-cursor', '!!!', '{"a":1}', 'e30'])(
        'rejects the cursor %j with InvalidCursorError',
        async (cursor) => {
          await createMany(2);

          await expect(store.listConversations(1, cursor)).rejects.toBeInstanceOf(
            InvalidCursorError,
          );
        },
      );

      test.each([0, -1, 1.5, Number.NaN])('rejects the limit %s with RangeError', async (limit) => {
        await expect(store.listConversations(limit)).rejects.toBeInstanceOf(RangeError);
      });

      test('mutating the returned page does not change what the next listing returns', async () => {
        const { id } = await store.createConversation({ title: 'title' });

        const page = await store.listConversations(10);
        page.conversations.push({ id: 'fake', updatedAt: new Date(), messageCount: 0 });
        const first = page.conversations[0];
        if (first) {
          first.title = 'changed';
          first.updatedAt.setFullYear(1999);
        }

        const again = await store.listConversations(10);
        expect(again.conversations).toHaveLength(1);
        expect(again.conversations[0]).toMatchObject({ id, title: 'title' });
        expect(again.conversations[0]?.updatedAt.getFullYear()).toBeGreaterThan(2000);
      });
    });

    describe('automatic title', () => {
      test('the first user message becomes the title of an untitled conversation', async () => {
        const { id } = await store.createConversation();

        await store.appendMessages(id, [
          { role: 'user', content: 'What time is it in Istanbul?' },
          { role: 'assistant', content: 'It is noon.' },
        ]);

        expect((await store.getConversation(id))?.title).toBe('What time is it in Istanbul?');
        expect((await store.listConversations(10)).conversations[0]?.title).toBe(
          'What time is it in Istanbul?',
        );
      });

      test('the title is cut to 50 characters', async () => {
        const { id } = await store.createConversation();

        await store.appendMessages(id, [{ role: 'user', content: 'x'.repeat(300) }]);

        expect((await store.getConversation(id))?.title).toBe('x'.repeat(50));
      });

      test('a title given at creation is kept', async () => {
        const { id } = await store.createConversation({ title: 'mine' });

        await store.appendMessages(id, [{ role: 'user', content: 'something else' }]);

        expect((await store.getConversation(id))?.title).toBe('mine');
      });

      test('an empty title counts as no title', async () => {
        const { id } = await store.createConversation({ title: '' });

        await store.appendMessages(id, [{ role: 'user', content: 'filled in' }]);

        expect((await store.getConversation(id))?.title).toBe('filled in');
      });

      test('the title is set once and later messages do not change it', async () => {
        const { id } = await store.createConversation();

        await store.appendMessages(id, [{ role: 'user', content: 'first' }]);
        await store.appendMessages(id, [{ role: 'user', content: 'second' }]);

        expect((await store.getConversation(id))?.title).toBe('first');
      });

      test('messages without a user message leave the title empty until one arrives', async () => {
        const { id } = await store.createConversation();

        await store.appendMessages(id, [{ role: 'system', content: 'be brief' }]);
        expect((await store.getConversation(id))?.title).toBeUndefined();

        await store.appendMessages(id, [{ role: 'user', content: 'now a question' }]);
        expect((await store.getConversation(id))?.title).toBe('now a question');
      });

      test('appending nothing does not give a title', async () => {
        const { id } = await store.createConversation();

        await store.appendMessages(id, []);

        expect((await store.getConversation(id))?.title).toBeUndefined();
      });
    });
  });
}
