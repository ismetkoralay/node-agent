import { HttpException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConversationNotFoundError, createAgent, InMemoryChatStore } from '@node-agent/core';
import { FakeProvider, textResponse } from '@node-agent/core/testing';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatService } from './chat.service.ts';

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
      const err = new NotFoundException(`Conversation with ID: ${id} is not found`);
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
      const err = new NotFoundException(`Conversation with ID: ${id} is not found`);

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
    test('getMessages maps unexpected store errors to InternalServerErrorException', async () => {
      const storeError = new Error('disk is on fire');
      vi.spyOn(store, 'getMessages').mockRejectedValue(storeError);

      const err = await service.getMessages(crypto.randomUUID()).catch((e) => e);

      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(err.cause).toBe(storeError);
    });

    test('getMessages throws when the conversation does not exist for given id', async () => {
      const id = crypto.randomUUID();
      const conversationNotFoundError = new ConversationNotFoundError(id);
      const err = new NotFoundException(conversationNotFoundError.message, {
        cause: conversationNotFoundError,
      });

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
});
