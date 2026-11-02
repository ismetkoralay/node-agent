import { AgentError, type Message } from '@node-agent/core';
import type { messagesTable } from '../database/database.schema.ts';

export type MessageRow = typeof messagesTable.$inferSelect;
export type NewMessageRow = typeof messagesTable.$inferInsert;

export function messageToRow(conversationId: string, seq: number, message: Message): NewMessageRow {
  return {
    conversation_id: conversationId,
    seq,
    role: message.role,
    content: message.content,
    tool_calls: message.role === 'assistant' ? (message.tool_calls ?? null) : null,
    tool_call_id: message.role === 'tool' ? message.tool_call_id : null,
  };
}

/**
 * Only an assistant message may have `null` content. For any other role, or a tool message
 * without `tool_call_id`, the row is corrupt: throwing beats inventing a value the user never sent.
 */
export function rowToMessage(row: MessageRow): Message {
  const { role, content } = row;

  if (role === 'assistant') {
    return row.tool_calls ? { role, content, tool_calls: row.tool_calls } : { role, content };
  }

  if (content === null) {
    throw corruptRow(row, 'content is null');
  }

  if (role === 'tool') {
    if (row.tool_call_id === null) {
      throw corruptRow(row, 'tool_call_id is null');
    }
    return { role, content, tool_call_id: row.tool_call_id };
  }

  return { role, content };
}

function corruptRow(row: MessageRow, reason: string): AgentError {
  return new AgentError(
    `Message ${row.id} (role ${row.role}) is corrupt: ${reason}`,
    'corrupt_message_row',
  );
}
