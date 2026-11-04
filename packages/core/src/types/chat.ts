import type { AssistantMessage, Message } from './message.ts';
import type { ToolCall, ToolDefinition } from './tool.ts';

/** A provider-neutral chat completion request. */
export type ChatRequest = {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, string>;
};

/** A provider-neutral chat completion result: the assistant message and why generation ended. */
export type ChatResponse = {
  message: AssistantMessage;
  finishReason: 'stop' | 'tool_calls' | 'length';
  usage?: { promptTokens: number; completionTokens: number };
};

/**
 * One piece of a streamed answer. A stream is any number of `text.delta` (new text only, not
 * cumulative) and `tool_call` chunks, followed by exactly one `finish`, which is always last.
 * A `tool_call` is complete: its `arguments` are the full JSON string, never a fragment.
 */
export type ChatChunk =
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'finish'; finishReason: ChatResponse['finishReason']; usage?: ChatResponse['usage'] };

/** The terminating chunk of a stream; internal helper, deliberately not part of the public API. */
export type FinishChunk = Extract<ChatChunk, { type: 'finish' }>;
