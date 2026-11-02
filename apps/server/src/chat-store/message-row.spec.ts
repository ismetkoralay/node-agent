import type { AssistantMessage, SystemMessage, ToolMessage, UserMessage } from '@node-agent/core';
import { describe, expect, test } from 'vitest';
import { type MessageRow, messageToRow, rowToMessage } from './message-row.ts';

describe('RowToMessage', () => {
  const baseMessage: MessageRow = {
    id: 'msg1',
    conversation_id: 'conv1',
    seq: 1,
    created_at: new Date(),
    tool_call_id: null,
    tool_calls: null,
    role: 'assistant',
    content: 'hello',
    metadata: {},
  };

  describe('role: assistant', () => {
    test('should successfully map a MessageRow with content and tool_calls to a Message', () => {
      const messageRow: MessageRow = {
        ...baseMessage,
        tool_calls: [
          {
            id: 'tool1',
            type: 'function',
            function: {
              name: 'function1',
              arguments: '{"arg1": "value1"}',
            },
          },
        ],
      };

      const message = rowToMessage(messageRow);
      expect(message).toStrictEqual({
        role: 'assistant',
        content: 'hello',
        tool_calls: [
          {
            id: 'tool1',
            type: 'function',
            function: {
              name: 'function1',
              arguments: '{"arg1": "value1"}',
            },
          },
        ],
      });
    });

    test('should successfully map a MessageRow without content and tool_calls to a Message', () => {
      const messageRow: MessageRow = {
        ...baseMessage,
        content: null,
        tool_calls: null,
      };

      const message = rowToMessage(messageRow);
      expect(message).not.toHaveProperty('tool_calls');
      expect(message).toStrictEqual({
        role: 'assistant',
        content: null,
      });
    });
  });

  describe('role: system', () => {
    test('should successfully map a MessageRow to a Message', () => {
      const messageRow: MessageRow = {
        ...baseMessage,
        role: 'system',
        content: 'system message',
      };
      const message = rowToMessage(messageRow);
      expect(message).toStrictEqual({
        role: 'system',
        content: 'system message',
      });
    });
  });

  describe('role: user', () => {
    test('should successfully map a MessageRow to a Message', () => {
      const messageRow: MessageRow = {
        ...baseMessage,
        role: 'user',
        content: 'user message',
      };
      const message = rowToMessage(messageRow);
      expect(message).not.toHaveProperty('tool_calls');
      expect(message).not.toHaveProperty('tool_call_id');
      expect(message).toStrictEqual({
        role: 'user',
        content: 'user message',
      });
    });
  });

  describe('role: tool', () => {
    test('should successfully map a MessageRow to a Message', () => {
      const messageRow: MessageRow = {
        ...baseMessage,
        role: 'tool',
        content: 'tool message',
        tool_call_id: 'tool-call-123',
      };
      const message = rowToMessage(messageRow);
      expect(message).toStrictEqual({
        role: 'tool',
        content: 'tool message',
        tool_call_id: 'tool-call-123',
      });
    });
  });
});

describe('MessageToRow', () => {
  test('should successfully map a Message to a NewMessageRow with assistant role', () => {
    const message: AssistantMessage = {
      role: 'assistant',
      content: 'hello',
      tool_calls: [
        {
          id: 'tool1',
          type: 'function',
          function: {
            name: 'function1',
            arguments: '{"arg1": "value1"}',
          },
        },
      ],
    };
    const messageRow = messageToRow('conv1', 1, message);
    expect(messageRow).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      tool_calls: [
        {
          id: 'tool1',
          type: 'function',
          function: {
            name: 'function1',
            arguments: '{"arg1": "value1"}',
          },
        },
      ],
      role: 'assistant',
      content: 'hello',
    });
  });

  test('should successfully map a Message to a NewMessageRow with user role', () => {
    const message: UserMessage = {
      role: 'user',
      content: 'hello',
    };
    const messageRow = messageToRow('conv1', 1, message);
    expect(messageRow).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      role: 'user',
      content: 'hello',
    });
  });

  test('should successfully map a Message to a NewMessageRow with systen role', () => {
    const message: SystemMessage = {
      role: 'system',
      content: 'hello',
    };
    const messageRow = messageToRow('conv1', 1, message);
    expect(messageRow).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      role: 'system',
      content: 'hello',
    });
  });

  test('should successfully map a Message to a NewMessageRow with tool role', () => {
    const message: ToolMessage = {
      role: 'tool',
      content: 'hello',
      tool_call_id: 'tool-call-123',
    };
    const messageRow = messageToRow('conv1', 1, message);
    expect(messageRow).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      tool_call_id: 'tool-call-123',
      role: 'tool',
      content: 'hello',
    });
  });
});
