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

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

/** Query strings are text, so `limit` is coerced; an empty `limit=` or `cursor=` is rejected, not ignored. */
export const getConversationsSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_LIST_LIMIT)
      .default(DEFAULT_LIST_LIMIT)
      .describe('Number of conversations to return'),
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe('The `nextCursor` of the previous page; leave out for the first page'),
  })
  .meta({
    examples: [{ limit: 20 }, { limit: 20, cursor: 'eyJ1cGRhdGVkQXQiOi4uLn0' }],
  });

export type GetConversationsDto = z.infer<typeof getConversationsSchema>;
