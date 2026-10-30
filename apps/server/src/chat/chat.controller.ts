import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../common/http.helpers.ts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts';
import {
  type ConversationDto,
  conversationResponseSchema,
  errorResponseSchema,
  type MessagesResponseDto,
  messagesResponseSchema,
  type SendMessageResponseDto,
  sendMessageResponseSchema,
} from './chat.responses.ts';
import {
  type CreateConversationDto,
  conversationIdSchema,
  createConversationSchema,
  type SendMessageDto,
  sendMessageSchema,
} from './chat.schemas.ts';
import { ChatService } from './chat.service.ts';

const idParam = {
  schema: conversationIdSchema,
  pipes: [new ZodValidationPipe(conversationIdSchema)],
};

@ApiTags('conversations')
@ApiResponse({
  status: 400,
  description: 'validation_error: the body or the id is invalid',
  standardSchema: errorResponseSchema,
})
@Controller('v1/conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a conversation',
    description: 'Opens an empty conversation. The body is optional.',
  })
  @ApiBody({ required: false })
  @ApiResult(201, 'The new conversation', conversationResponseSchema)
  async createConversation(
    @Body({
      schema: createConversationSchema,
      // The body is optional: with no body and no content-type Express leaves `req.body` undefined.
      pipes: [new ZodValidationPipe(createConversationSchema.default({}))],
    })
    request: CreateConversationDto,
  ): Promise<ConversationDto> {
    return await this.chatService.createConversation(request);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get a conversation' })
  @ApiResult(200, 'The conversation', conversationResponseSchema)
  @ApiResponse({
    status: 404,
    description: 'conversation_not_found',
    standardSchema: errorResponseSchema,
  })
  async getConversation(@Param('id', idParam) id: string): Promise<ConversationDto> {
    return await this.chatService.getConversation(id);
  }

  @Post('/:id/messages')
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Runs the agent on the message, including any tool calls, and returns its final answer. ' +
      'Needs a reachable LLM provider. Only one message can run in a conversation at a time.',
  })
  @ApiResult(200, 'The final assistant message of the run', sendMessageResponseSchema)
  @ApiResponse({
    status: 404,
    description: 'conversation_not_found',
    standardSchema: errorResponseSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'conversation_busy: another message is still running in this conversation',
    standardSchema: errorResponseSchema,
  })
  @ApiResponse({
    status: 502,
    description: 'provider_unavailable: the language model could not be reached',
    standardSchema: errorResponseSchema,
  })
  async sendMessage(
    @Param('id', idParam) id: string,
    @Body({
      schema: sendMessageSchema,
      pipes: [new ZodValidationPipe(sendMessageSchema)],
    })
    request: SendMessageDto,
  ): Promise<SendMessageResponseDto> {
    return this.chatService.sendMessage(id, request);
  }

  @Get('/:id/messages')
  @ApiOperation({ summary: 'Get the message history of a conversation' })
  @ApiResult(200, 'The messages, oldest first', messagesResponseSchema)
  @ApiResponse({
    status: 404,
    description: 'conversation_not_found',
    standardSchema: errorResponseSchema,
  })
  async getMessages(@Param('id', idParam) id: string): Promise<MessagesResponseDto> {
    return await this.chatService.getMessages(id);
  }
}
