import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts';
import {
  type ConversationDto,
  type CreateConversationDto,
  createConversationSchema,
  type GetMessagesDto,
  type SendMessageDto,
  type SendMessageResponseDto,
  sendMessageSchema,
} from './chat.schemas.ts';
import { ChatService } from './chat.service.ts';

@Controller('v1/conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async createConversation(
    @Body(new ZodValidationPipe(createConversationSchema)) request: CreateConversationDto,
  ): Promise<ConversationDto> {
    return await this.chatService.createConversation(request);
  }

  @Get('/:id')
  async getConversation(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConversationDto> {
    return this.chatService.getConversation(id);
  }

  @Post('/:id/messages')
  @HttpCode(200)
  async sendMessage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) request: SendMessageDto,
  ): Promise<SendMessageResponseDto> {
    return this.chatService.sendMessage(id, request);
  }

  @Get('/:id/messages')
  async getMessages(@Param('id', new ParseUUIDPipe()) id: string): Promise<GetMessagesDto> {
    return await this.chatService.getMessages(id);
  }
}
