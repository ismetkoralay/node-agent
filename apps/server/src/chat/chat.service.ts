import { Inject, Injectable } from '@nestjs/common';
import {
  type Agent,
  type AgentRunResult,
  type ChatStore,
  ConversationNotFoundError,
} from '@node-agent/core';
import { AGENT, CHAT_STORE } from '../agent/tokens.ts';
import type {
  ConversationDto,
  CreateConversationDto,
  GetMessagesDto,
  SendMessageDto,
  SendMessageResponseDto,
} from './chat.schemas.ts';
import { ConversationBusyError } from './conversation-busy.error.ts';

@Injectable()
export class ChatService {
  private readonly busy: Set<string> = new Set<string>();
  constructor(
    @Inject(CHAT_STORE) private readonly chatStore: ChatStore,
    @Inject(AGENT) private readonly agent: Agent,
  ) {}

  async createConversation(request: CreateConversationDto): Promise<ConversationDto> {
    const res = await this.chatStore.createConversation({
      title: request?.title,
      metadata: request?.metadata,
    });

    return {
      id: res.id,
      createdAt: res.createdAt,
      title: res.title,
    };
  }

  async getConversation(id: string): Promise<ConversationDto> {
    const res = await this.chatStore.getConversation(id);
    if (res == null) {
      throw new ConversationNotFoundError(id);
    }

    return {
      id: res.id,
      createdAt: res.createdAt,
      title: res.title,
    };
  }

  async sendMessage(id: string, request: SendMessageDto): Promise<SendMessageResponseDto> {
    const conversation = await this.chatStore.getConversation(id);
    if (conversation == null) {
      throw new ConversationNotFoundError(id);
    }

    if (this.busy.has(id)) {
      throw new ConversationBusyError(id);
    }
    this.busy.add(id);

    let response: AgentRunResult;
    try {
      response = await this.agent.run({
        conversationId: conversation.id,
        input: request.content,
      });
    } finally {
      this.busy.delete(id);
    }

    return {
      message: response.message,
      steps: response.steps,
      usage: response.usage,
      finishReason: response.finishReason,
    };
  }

  async getMessages(id: string): Promise<GetMessagesDto> {
    const messages = await this.chatStore.getMessages(id);
    return { messages };
  }
}
