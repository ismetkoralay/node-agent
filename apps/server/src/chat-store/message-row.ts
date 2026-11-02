import type { Message } from '@node-agent/core';
import type { messagesTable } from '../database/database.schema.ts';

export type MessageRow = typeof messagesTable.$inferSelect;
export type NewMessageRow = typeof messagesTable.$inferInsert;

export function messageToRow(conversationId: string, seq: number, message: Message): NewMessageRow {
  const row: NewMessageRow = {
    conversation_id: conversationId,
    role: message.role,
    seq: seq,
    content: message.content,
  };

  if (message.role === 'assistant') {
    row.tool_calls = message.tool_calls;
  }

  if (message.role === 'tool') {
    row.tool_call_id = message.tool_call_id;
  }

  return row;
}

export function rowToMessage(row: MessageRow): Message {
  switch (row.role) {
    case 'assistant':
      return row.tool_calls
        ? {
            role: row.role,
            content: row.content ?? null,
            tool_calls: row.tool_calls,
          }
        : {
            role: row.role,
            content: row.content ?? null,
          };
    case 'system':
      return {
        role: row.role,
        content: row.content ?? '',
      };
    case 'tool':
      return {
        role: row.role,
        content: row.content ?? '',
        tool_call_id: row.tool_call_id ?? '',
      };
    default:
      return {
        role: row.role,
        content: row.content ?? '',
      };
  }
}
