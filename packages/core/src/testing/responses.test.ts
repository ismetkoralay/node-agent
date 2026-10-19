import { expect, test } from 'vitest';
import { textResponse, toolCallResponse } from './responses.ts';

test('textResponse builds a final assistant message', () => {
  expect(textResponse('Merhaba')).toEqual({
    message: { role: 'assistant', content: 'Merhaba' },
    finishReason: 'stop',
  });
});

test('toolCallResponse stringifies args and assigns deterministic ids', () => {
  expect(
    toolCallResponse([
      { name: 'get_current_time', args: { timezone: 'UTC' } },
      { name: 'ping', args: {} },
    ]),
  ).toEqual({
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_current_time', arguments: '{"timezone":"UTC"}' },
        },
        { id: 'call_2', type: 'function', function: { name: 'ping', arguments: '{}' } },
      ],
    },
    finishReason: 'tool_calls',
  });
});
