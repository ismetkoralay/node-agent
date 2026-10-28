import { HttpException } from '@nestjs/common';
import {
  type ChatResponse,
  ConversationNotFoundError,
  createAgent,
  InMemoryChatStore,
  type LLMProvider,
  ProviderError,
} from '@node-agent/core';
import { FakeProvider, textResponse } from '@node-agent/core/testing';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatService } from './chat.service.ts';
import { ConversationBusyError } from './conversation-busy.error.ts';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Chat Service', () => {
  let service: ChatService;
  let store: InMemoryChatStore;
  beforeEach(() => {
    store = new InMemoryChatStore();
    const provider = new FakeProvider([textResponse('hello from provider')]);
    const agent = createAgent({
      model: 'test-model',
      provider: provider,
      store: store,
    });
    service = new ChatService(store, agent);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Create Conversation', () => {
    test('createConversation successfully generates a new conversation without title and metadata', async () => {
      const res = await service.createConversation({});

      expect(res.id).toMatch(UUID_V4_REGEX);
      expect(res.createdAt).toStrictEqual(new Date('2026-10-22T10:00:00Z'));
      expect(res.title).toBeUndefined();
    });

    test('createConversation successfully generates a new conversation with title and metadata', async () => {
      const res = await service.createConversation({
        metadata: { a: 'b' },
        title: 'new title',
      });

      expect(res.id).toMatch(UUID_V4_REGEX);
      expect(res.createdAt).toStrictEqual(new Date('2026-10-22T10:00:00Z'));
      expect(res.title).toBeDefined();
      expect(res.title).toBe('new title');

      const stored = await store.getConversation(res.id);
      expect(stored?.metadata).toStrictEqual({ a: 'b' });
    });
  });

  describe('Get Conversation', () => {
    test('getConversation throws for nonexisting conversation id', async () => {
      const id = crypto.randomUUID();
      const err = new ConversationNotFoundError(id);
      await expect(service.getConversation(id)).rejects.toStrictEqual(err);
    });

    test('getConversation returns successfully for existing conversation id', async () => {
      const conv = await service.createConversation({
        title: 'new conv',
        metadata: { a: 'b' },
      });
      expect(conv).toBeDefined();

      const res = await service.getConversation(conv.id);
      expect(res.id).toBe(conv.id);
      expect(res.createdAt).toStrictEqual(conv.createdAt);
      expect(res.title).toBe(conv.title);
    });
  });

  describe('Send Message', () => {
    test('sendMessage fails when a conversation does not exist for given id', async () => {
      const id = crypto.randomUUID();
      const err = new ConversationNotFoundError(id);

      await expect(service.sendMessage(id, { content: '' })).rejects.toStrictEqual(err);
    });

    test('sendMessage returns response for a successful call', async () => {
      const conv = await service.createConversation({});
      expect(conv).toBeDefined();

      const res = await service.sendMessage(conv.id, {
        content: 'hello',
      });

      expect(res.message).toMatchObject({
        role: 'assistant',
        content: 'hello from provider',
      });
      expect(res.finishReason).toBe('stop');
      expect(res.steps).toBe(1);
      expect(res.usage).toStrictEqual({ promptTokens: 0, completionTokens: 0 });
    });

    test('sendMessage passes agent errors through without wrapping them', async () => {
      const providerError = new Error('provider is down');
      const failingAgent = createAgent({
        model: 'test-model',
        provider: new FakeProvider([providerError]),
        store,
      });
      const failingService = new ChatService(store, failingAgent);
      const conv = await failingService.createConversation({});

      const err = await failingService.sendMessage(conv.id, { content: 'hello' }).catch((e) => e);

      expect(err).not.toBeInstanceOf(HttpException);
      expect(err).toBe(providerError);
      await expect(failingService.getMessages(conv.id)).resolves.toStrictEqual({ messages: [] });
    });
  });

  describe('Get Messages', () => {
    test('getMessages throws when the conversation does not exist for given id', async () => {
      const id = crypto.randomUUID();
      const err = new ConversationNotFoundError(id);

      await expect(service.getMessages(id)).rejects.toMatchObject(err);
    });

    test('getMessages returns successfully for existing conversation id', async () => {
      const conv = await service.createConversation({});
      expect(conv).toBeDefined();

      const sendMessageResponse = await service.sendMessage(conv.id, {
        content: 'hello',
      });
      expect(sendMessageResponse).toBeDefined();
      expect(sendMessageResponse.finishReason).toBe('stop');
      expect(sendMessageResponse.message).toMatchObject({
        role: 'assistant',
        content: 'hello from provider',
      });

      const res = await service.getMessages(conv.id);
      expect(res).toMatchObject({
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
          {
            role: 'assistant',
            content: 'hello from provider',
          },
        ],
      });
    });
  });

  describe('Conversation lock', () => {
    /** A provider whose calls stay pending until the test releases them, so runs overlap deterministically. */
    class GatedProvider implements LLMProvider {
      readonly name = 'gated';
      readonly #waiting: ((response: ChatResponse | Error) => void)[] = [];

      chat(): Promise<ChatResponse> {
        return new Promise((resolve, reject) => {
          this.#waiting.push((outcome) =>
            outcome instanceof Error ? reject(outcome) : resolve(outcome),
          );
        });
      }

      get pending(): number {
        return this.#waiting.length;
      }

      release(outcome: ChatResponse | Error): void {
        const next = this.#waiting.shift();
        if (next === undefined) throw new Error('no pending provider call');
        next(outcome);
      }
    }

    let gate: GatedProvider;
    let lockedService: ChatService;

    beforeEach(() => {
      gate = new GatedProvider();
      lockedService = new ChatService(
        store,
        createAgent({ model: 'test-model', provider: gate, store }),
      );
    });

    /** Lets the first run reach the provider call, i.e. be past the lock check and inside `agent.run`. */
    async function untilProviderIsCalled(calls = 1): Promise<void> {
      await vi.waitFor(() => expect(gate.pending).toBe(calls));
    }

    test('rejects a second message to the same conversation while the first is running', async () => {
      const { id } = await lockedService.createConversation({});
      const first = lockedService.sendMessage(id, { content: 'first' });
      await untilProviderIsCalled();

      const err = await lockedService.sendMessage(id, { content: 'second' }).catch((e) => e);

      expect(err).toBeInstanceOf(ConversationBusyError);
      expect(err).toMatchObject({ code: 'conversation_busy', conversationId: id });
      gate.release(textResponse('answer to first'));
      await expect(first).resolves.toMatchObject({ message: { content: 'answer to first' } });
    });

    test('a rejected busy request does not touch the history', async () => {
      const { id } = await lockedService.createConversation({});
      const first = lockedService.sendMessage(id, { content: 'first' });
      await untilProviderIsCalled();
      await lockedService.sendMessage(id, { content: 'second' }).catch(() => undefined);

      gate.release(textResponse('answer to first'));
      await first;

      const { messages } = await lockedService.getMessages(id);
      expect(messages.map((m) => m.content)).toStrictEqual(['first', 'answer to first']);
      expect(gate.pending).toBe(0);
    });

    test('a request rejected as busy does not release the lock of the running one', async () => {
      const { id } = await lockedService.createConversation({});
      const first = lockedService.sendMessage(id, { content: 'first' });
      await untilProviderIsCalled();

      const second = await lockedService.sendMessage(id, { content: 'second' }).catch((e) => e);
      const third = await lockedService.sendMessage(id, { content: 'third' }).catch((e) => e);

      expect(second).toBeInstanceOf(ConversationBusyError);
      expect(third).toBeInstanceOf(ConversationBusyError);
      gate.release(textResponse('answer to first'));
      await first;
    });

    test('releases the lock once the run finishes', async () => {
      const { id } = await lockedService.createConversation({});
      const first = lockedService.sendMessage(id, { content: 'first' });
      await untilProviderIsCalled();
      gate.release(textResponse('answer to first'));
      await first;

      const second = lockedService.sendMessage(id, { content: 'second' });
      await untilProviderIsCalled();
      gate.release(textResponse('answer to second'));

      await expect(second).resolves.toMatchObject({ message: { content: 'answer to second' } });
    });

    test('releases the lock when the run fails, and the failed run leaves no messages', async () => {
      const { id } = await lockedService.createConversation({});
      const first = lockedService.sendMessage(id, { content: 'first' });
      const failure = new ProviderError('down', { provider: 'gated', retryable: true });
      await untilProviderIsCalled();
      gate.release(failure);
      await expect(first).rejects.toBe(failure);

      const second = lockedService.sendMessage(id, { content: 'second' });
      await untilProviderIsCalled();
      gate.release(textResponse('answer to second'));
      await second;

      const { messages } = await lockedService.getMessages(id);
      expect(messages.map((m) => m.content)).toStrictEqual(['second', 'answer to second']);
    });

    test('different conversations do not block each other', async () => {
      const a = await lockedService.createConversation({});
      const b = await lockedService.createConversation({});

      const first = lockedService.sendMessage(a.id, { content: 'in a' });
      const second = lockedService.sendMessage(b.id, { content: 'in b' });
      await untilProviderIsCalled(2);
      gate.release(textResponse('answer a'));
      gate.release(textResponse('answer b'));

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    });

    test('an unknown conversation fails with not found and takes no lock', async () => {
      const id = crypto.randomUUID();

      await expect(lockedService.sendMessage(id, { content: 'hi' })).rejects.toBeInstanceOf(
        ConversationNotFoundError,
      );
      await expect(lockedService.sendMessage(id, { content: 'hi' })).rejects.toBeInstanceOf(
        ConversationNotFoundError,
      );
    });
  });
});
