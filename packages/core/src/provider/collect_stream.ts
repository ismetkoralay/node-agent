import { AgentError } from '../errors/agent_error.ts';
import type { ChatChunk, ChatResponse, FinishChunk } from '../types/chat.ts';
import type { AssistantMessage } from '../types/message.ts';
import type { ToolCall } from '../types/tool.ts';

/**
 * Folds the chunks of one streamed answer back into the `ChatResponse`.
 */
export class ChunkCollector {
  #text = '';
  readonly #toolCalls: ToolCall[] = [];
  #finish: FinishChunk | undefined;

  add(chunk: ChatChunk): void {
    if (this.#finish) {
      throw new AgentError(
        'Cannot add more chunks after the stream has finished',
        'stream_already_finished',
      );
    }

    switch (chunk.type) {
      case 'text.delta':
        this.#text += chunk.text;
        break;
      case 'tool_call':
        this.#toolCalls.push(chunk.toolCall);
        break;
      case 'finish':
        this.#finish = chunk;
        break;
      default: {
        // Typed callers can't get here; this guards sources that skip the type checker.
        const unknown: never = chunk;
        throw new AgentError(
          `Unknown chunk type "${(unknown as { type: string }).type}"`,
          'unknown_chunk_type',
        );
      }
    }
  }

  response(): ChatResponse {
    if (!this.#finish) {
      throw new AgentError(
        'Cannot build a response before the stream has finished',
        'stream_not_finished',
      );
    }

    const { finishReason, usage } = this.#finish;
    const hasToolCalls = this.#toolCalls.length > 0;
    const message: AssistantMessage = {
      role: 'assistant',
      content: this.#text === '' && hasToolCalls ? null : this.#text,
      ...(hasToolCalls ? { tool_calls: [...this.#toolCalls] } : {}),
    };

    return { message, finishReason, ...(usage ? { usage } : {}) };
  }
}

/**
 * Drains a stream into a single `ChatResponse`. Accepts a sync iterable too, so
 * `responseToChunks()` can be passed in directly.
 */
export async function collectStream(
  chunks: AsyncIterable<ChatChunk> | Iterable<ChatChunk>,
): Promise<ChatResponse> {
  const collector = new ChunkCollector();

  for await (const chunk of chunks) {
    collector.add(chunk);
  }

  return collector.response();
}

/**
 * Replays a finished `ChatResponse` as the chunks a streaming provider would have produced.
 */
export function* responseToChunks(
  response: ChatResponse,
  split?: (text: string) => readonly string[],
): Generator<ChatChunk, void, undefined> {
  const { content, tool_calls } = response.message;

  if (content !== null && content !== '') {
    const parts = split ? split(content) : [content];
    if (parts.join('') !== content) {
      throw new AgentError(
        'The split function must return parts that concatenate back to the original text',
        'invalid_split',
      );
    }
    for (const text of parts) {
      if (text !== '') yield { type: 'text.delta', text };
    }
  }

  for (const toolCall of tool_calls ?? []) {
    yield { type: 'tool_call', toolCall };
  }

  const { finishReason, usage } = response;
  yield usage ? { type: 'finish', finishReason, usage } : { type: 'finish', finishReason };
}
