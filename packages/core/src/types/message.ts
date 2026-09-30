import type { ToolCall } from './tool.ts';

/** One conversation turn, discriminated by `role`. Field names follow OpenAI's snake_case. */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** A `Message` with `role: 'system'`: instructions that steer the model. */
export type SystemMessage = Extract<Message, { role: 'system' }>;

/** A `Message` with `role: 'user'`: input from the end user. */
export type UserMessage = Extract<Message, { role: 'user' }>;

/** A `Message` with `role: 'assistant'`: model output, text and/or tool calls. */
export type AssistantMessage = Extract<Message, { role: 'assistant' }>;

/** A `Message` with `role: 'tool'`: the result of one tool call, matched by `tool_call_id`. */
export type ToolMessage = Extract<Message, { role: 'tool' }>;
