import type { Conversation, Message } from '@node-agent/core';
import { z } from 'zod';
import type { Same } from '../common/type-helpers.ts';

/*
 * Response schemas are the single source for three things: the runtime serialization check
 * (`StandardSchemaSerializerInterceptor`), the Swagger document, and the DTO types. They must not
 * be stricter than core's types: a legitimate value that core allows would otherwise become a 500.
 */

/** The service returns a `Date`; the client receives an ISO string. */
const isoDate = z.codec(z.date(), z.iso.datetime(), {
  decode: (d) => d.toISOString(),
  encode: (s) => new Date(s),
});

export const conversationResponseSchema = z
  .object({
    id: z.uuid().describe('Unique id of the conversation'),
    title: z.string().optional().describe('Title given when the conversation was created'),
    metadata: z.record(z.string(), z.string()).describe('Metadata given when it was created'),
    createdAt: isoDate.describe('Creation time'),
  })
  .meta({
    examples: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Current Time',
        metadata: { timezone: 'Europe/Istanbul' },
        createdAt: '2026-10-29T10:42:21.427Z',
      },
    ],
  });

/** What the service returns (`createdAt` is a `Date`); `z.output` is the JSON the client sees. */
export type ConversationDto = z.input<typeof conversationResponseSchema>;
const _checkConversation: Same<ConversationDto, Conversation> = true;

/** Documentation only: error responses are built by `AllExceptionsFilter`, not serialized. */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().describe('Stable snake_case identifier of the error'),
      message: z.string(),
      requestId: z.string().describe('Equals the `x-request-id` response header'),
      details: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .describe('Present only for `validation_error`'),
    }),
  })
  .meta({
    examples: [
      {
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          requestId: 'c1b7a0a6-3f55-4b0c-9a40-0f6d2d7a8f11',
          details: [{ path: 'id', message: 'Invalid UUID' }],
        },
      },
    ],
  });

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable(),
  tool_calls: z.array(toolCallSchema).optional(),
});

const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  assistantMessageSchema,
  z.object({ role: z.literal('tool'), tool_call_id: z.string(), content: z.string() }),
]);
const _checkMessage: Same<z.input<typeof messageSchema>, Message> = true;

export const sendMessageResponseSchema = z.object({
  message: assistantMessageSchema.describe('The final assistant message of the run'),
  steps: z.number().describe('Number of model calls the run took'),
  usage: z.object({ promptTokens: z.number(), completionTokens: z.number() }),
  finishReason: z.enum(['stop', 'length', 'max_steps']),
});

export type SendMessageResponseDto = z.input<typeof sendMessageResponseSchema>;

export const messagesResponseSchema = z.object({ messages: z.array(messageSchema) });

export type MessagesResponseDto = z.input<typeof messagesResponseSchema>;
