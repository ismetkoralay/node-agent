import type { ChatResponse } from '../types/chat.ts';

/** A final assistant text answer. */
export function textResponse(content: string): ChatResponse {
  return { message: { role: 'assistant', content }, finishReason: 'stop' };
}

/**
 * An assistant turn that asks for tool calls. `args` is serialised with `JSON.stringify`, and calls
 * get the deterministic ids `call_1`, `call_2`, ... so tests can match them by `tool_call_id`.
 */
export function toolCallResponse(calls: { name: string; args: unknown }[]): ChatResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: calls.map((call, i) => ({
        id: `call_${i + 1}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    },
    finishReason: 'tool_calls',
  };
}
