import { z } from 'zod';

export const createConversationSchema = z
  .object({
    title: z.string().optional().describe('title of the new conversation'),
    metadata: z
      .record(z.string(), z.string())
      .optional()
      .describe('optional metadata for the conversation'),
  })
  .meta({
    examples: [{ title: 'Current Time', metadata: { timezone: 'Europe/Istanbul' } }],
  });

export type CreateConversationDto = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(8000),
  })
  .meta({
    examples: [{ content: 'What time is it in Istanbul?' }],
  });

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const conversationIdSchema = z.uuid().describe('Id of the conversation');
