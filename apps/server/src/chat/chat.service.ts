import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { type Agent, type ChatStore, ConversationNotFoundError } from '@node-agent/core';
import { AGENT, CHAT_STORE } from '../agent/tokens.ts';
import type {
  ConversationDto,
  CreateConversationDto,
  GetMessagesDto,
  SendMessageDto,
  SendMessageResponseDto,
} from './chat.schemas.ts';

@Injectable()
export class ChatService {
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
      throw new NotFoundException(`Conversation with ID: ${id} is not found`);
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
      throw new NotFoundException(`Conversation with ID: ${id} is not found`);
    }

    const response = await this.agent.run({
      conversationId: conversation.id,
      input: request.content,
    });

    return {
      message: response.message,
      steps: response.steps,
      usage: response.usage,
      finishReason: response.finishReason,
    };
  }

  async getMessages(id: string): Promise<GetMessagesDto> {
    try {
      const messages = await this.chatStore.getMessages(id);
      return { messages };
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        throw new NotFoundException(error.message, {
          cause: error,
        });
      }

      throw new InternalServerErrorException('Something went wrong', {
        cause: error,
      });
    }
  }
}
