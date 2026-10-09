import { randomUUID } from 'node:crypto';
import {
  type ChatRequest,
  type ChatResponse,
  type Message,
  ProviderError,
  type ToolCall,
  type ToolDefinition,
} from '@node-agent/core';
import type {
  Message as OllamaMessage,
  Options as OllamaOptions,
  ChatRequest as OllamaRequest,
  ChatResponse as OllamaResponse,
  Tool as OllamaTool,
  ToolCall as OllamaToolCall,
} from 'ollama';
import { PROVIDER_NAME } from './constants.ts';

/** Translates a provider-neutral request into an Ollama `/api/chat` request (non-streaming). */
export function toOllamaRequest(req: ChatRequest): OllamaRequest & { stream: false } {
  const options: NonNullable<Partial<OllamaOptions>> = {};
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;

  return {
    model: req.model,
    stream: false,
    messages: req.messages.map(toOllamaMessage),
    ...(req.tools && { tools: req.tools.map(mapTools) }),
    ...(Object.keys(options).length > 0 && { options }),
  };
}

function toOllamaMessage(message: Message, index: number, messages: Message[]): OllamaMessage {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...(message.tool_calls?.length && { tool_calls: message.tool_calls.map(toOllamaToolCall) }),
      };
    case 'tool':
      // Ollama has no call ids: a result is matched to its call by tool name.
      return {
        role: 'tool',
        content: message.content,
        tool_name: findToolName(messages, index, message.tool_call_id),
      };
    default:
      return { role: message.role, content: message.content };
  }
}

function toOllamaToolCall(call: ToolCall): OllamaToolCall {
  return { function: { name: call.function.name, arguments: parseArguments(call) } };
}

function parseArguments(call: ToolCall): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments);
  } catch (err) {
    throw invalidToolCall(call, 'are not valid JSON', err);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidToolCall(call, 'are not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function invalidToolCall(call: ToolCall, reason: string, cause?: unknown): ProviderError {
  return new ProviderError(
    `Arguments of tool call "${call.function.name}" (${call.id}) ${reason}`,
    { provider: PROVIDER_NAME, retryable: false, cause },
  );
}

/** Finds the name of the call a tool result answers, in the nearest earlier assistant message that made it. */
function findToolName(messages: Message[], resultIndex: number, toolCallId: string): string {
  for (let i = resultIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const match = message.tool_calls?.find((call) => call.id === toolCallId);
    if (match) return match.function.name;
  }
  throw new ProviderError(
    `Tool result refers to unknown tool_call_id "${toolCallId}": no earlier assistant message made that call`,
    { provider: PROVIDER_NAME, retryable: false },
  );
}

function mapTools(toolDefinition: ToolDefinition): OllamaTool {
  return {
    type: toolDefinition.type,
    function: {
      name: toolDefinition.function.name,
      description: toolDefinition.function.description,
      parameters: toolDefinition.function.parameters,
    },
  };
}

/**
 * Translates an Ollama `/api/chat` response into a provider-neutral one.
 */
export function fromOllamaResponse(
  res: OllamaResponse,
  generateId: () => string = defaultGenerateId,
): ChatResponse {
  const response: ChatResponse = {
    message: {
      role: 'assistant',
      content: res.message.content,
      ...(res.message.tool_calls?.length && {
        tool_calls: res.message.tool_calls.map((call) => ({
          id: generateId(),
          type: 'function',
          function: {
            name: call.function.name,
            arguments: JSON.stringify(call.function.arguments),
          },
        })),
      }),
    },
    finishReason: extractFinishReason(res),
  };
  if (typeof res.prompt_eval_count === 'number' && typeof res.eval_count === 'number') {
    response.usage = { promptTokens: res.prompt_eval_count, completionTokens: res.eval_count };
  }
  return response;
}

function defaultGenerateId(): string {
  return `call_${randomUUID()}`;
}

function extractFinishReason(res: OllamaResponse): 'stop' | 'tool_calls' | 'length' {
  if (res.message.tool_calls?.length && res.message.tool_calls.length > 0) return 'tool_calls';

  switch (res.done_reason) {
    case 'length':
      return 'length';
    case 'stop':
    case 'unload':
    case 'load':
      return 'stop';
    default:
      throw new ProviderError(`Unexpected Ollama done_reason: ${res.done_reason}`, {
        provider: PROVIDER_NAME,
        retryable: false,
      });
  }
}
