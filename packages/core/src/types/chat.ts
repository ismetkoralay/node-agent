import type { AssistantMessage, Message } from './message.ts';
import type { ToolDefinition } from './tool.ts';

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
