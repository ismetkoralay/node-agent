import { type ChatRequest, type ChatResponse, ProviderError } from '@node-agent/core';
import type {
  Options as OllamaOptions,
  ChatRequest as OllamaRequest,
  ChatResponse as OllamaResponse,
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
    messages: req.messages.map((message) => ({
      role: message.role,
      content: message.content ?? '',
    })),
    ...(Object.keys(options).length > 0 && { options }),
  };
}

/** Translates an Ollama `/api/chat` response into a provider-neutral one. */
export function fromOllamaResponse(res: OllamaResponse): ChatResponse {
  const response: ChatResponse = {
    message: { role: 'assistant', content: res.message.content },
    finishReason: extractFinishReason(res),
  };
  if (typeof res.prompt_eval_count === 'number' && typeof res.eval_count === 'number') {
    response.usage = { promptTokens: res.prompt_eval_count, completionTokens: res.eval_count };
  }
  return response;
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
