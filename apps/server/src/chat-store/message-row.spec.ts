import type {
  AssistantMessage,
  Message,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '@node-agent/core';
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

  describe('corrupt rows', () => {
    test.each(['system', 'user', 'tool'] as const)(
      'throws when a %s row has null content',
      (role) => {
        const messageRow: MessageRow = { ...baseMessage, role, content: null, tool_call_id: 'id' };

        expect(() => rowToMessage(messageRow)).toThrowError(
          expect.objectContaining({ code: 'corrupt_message_row' }),
        );
      },
    );

    test('throws when a tool row has null tool_call_id', () => {
      const messageRow: MessageRow = { ...baseMessage, role: 'tool', tool_call_id: null };

      expect(() => rowToMessage(messageRow)).toThrowError(
        expect.objectContaining({ code: 'corrupt_message_row' }),
      );
    });
  });
});

describe('MessageToRow', () => {
  const toolCalls = [
    {
      id: 'tool1',
      type: 'function' as const,
      function: { name: 'function1', arguments: '{"arg1": "value1"}' },
    },
  ];

  test('assistant: keeps tool_calls, leaves tool_call_id null', () => {
    const message: AssistantMessage = {
      role: 'assistant',
      content: 'hello',
      tool_calls: toolCalls,
    };

    expect(messageToRow('conv1', 1, message)).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      role: 'assistant',
      content: 'hello',
      tool_calls: toolCalls,
      tool_call_id: null,
    });
  });

  test('assistant without tool_calls: tool_calls is null', () => {
    const message: AssistantMessage = { role: 'assistant', content: null };

    expect(messageToRow('conv1', 1, message)).toMatchObject({ content: null, tool_calls: null });
  });

  test('user: tool_calls and tool_call_id are null', () => {
    const message: UserMessage = { role: 'user', content: 'hello' };

    expect(messageToRow('conv1', 1, message)).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      role: 'user',
      content: 'hello',
      tool_calls: null,
      tool_call_id: null,
    });
  });

  test('system: tool_calls and tool_call_id are null', () => {
    const message: SystemMessage = { role: 'system', content: 'hello' };

    expect(messageToRow('conv1', 1, message)).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      role: 'system',
      content: 'hello',
      tool_calls: null,
      tool_call_id: null,
    });
  });

  test('tool: keeps tool_call_id, leaves tool_calls null', () => {
    const message: ToolMessage = { role: 'tool', content: 'hello', tool_call_id: 'tool-call-123' };

    expect(messageToRow('conv1', 1, message)).toStrictEqual({
      conversation_id: 'conv1',
      seq: 1,
      role: 'tool',
      content: 'hello',
      tool_calls: null,
      tool_call_id: 'tool-call-123',
    });
  });
});

describe('round trip', () => {
  const messages: Message[] = [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'assistant', content: null },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'now', arguments: '{"tz":"UTC"}' } },
      ],
    },
    { role: 'tool', content: 'result', tool_call_id: 'call-1' },
  ];

  test.each(messages)('rowToMessage(messageToRow(...)) keeps a $role message', (message) => {
    const row: MessageRow = {
      ...messageToRow('conv1', 1, message),
      id: 'msg1',
      conversation_id: 'conv1',
      seq: 1,
      metadata: {},
      created_at: new Date(),
    } as MessageRow;

    expect(rowToMessage(row)).toStrictEqual(message);
  });
});
