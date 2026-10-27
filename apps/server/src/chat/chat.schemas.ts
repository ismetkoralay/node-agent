import type { AgentFinishReason, AssistantMessage, Message } from '@node-agent/core';
import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type CreateConversationDto = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
  content: z.string().max(8000).nonempty().nonoptional(),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

/*
 * Responses are plain types, not Zod schemas: nothing parses them. Envelope fields are camelCase
 * as in the issue; messages are core's `Message` untouched (snake_case, `content: null` kept).
 */
export type ConversationDto = {
  id: string;
  title?: string;
  createdAt: Date;
};

export type SendMessageResponseDto = {
  message: AssistantMessage;
  steps: number;
  usage: { promptTokens: number; completionTokens: number };
  finishReason: AgentFinishReason;
};

export type GetMessagesDto = {
  messages: Message[];
};
