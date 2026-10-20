import { z } from 'zod';
import type { ToolCall, ToolDefinition, ToolMessage } from '../types/index.ts';

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * The context in which a tool is executed.
 * This includes an AbortSignal for cancellation, a conversation ID for tracking,
 * and a logger for logging messages at different levels.
 */
export interface ToolContext {
  signal: AbortSignal;
  conversationId: string;
  logger: Logger;
}

/**
 * Represents a tool that can be executed with input and produces output.
 * Tools are defined with a name, description, input schema, and an execute function.
 * The input schema is defined using Zod for validation.
 *
 * @template I - The type of the input data for the tool.
 * @template O - The type of the output data produced by the tool.
 */
export interface Tool<I = unknown, O = unknown> {
  /**
   * The name of the tool.
   */
  name: string;

  /**
   * The description of the tool.
   * Model will use this to determine when to call the tool, so it should be clear and concise.
   */
  description: string;

  /**
   * The input schema for the tool, defined using Zod.
   * This schema is used to validate the input data before executing the tool.
   * @see https://zod.dev/
   */
  input: z.ZodType<I>;

  /**
   * The function that executes the tool's logic.
   * @param input - The input data for the tool.
   * @param ctx - The context in which the tool is executed.
   * @returns A promise that resolves to the output of the tool.
   */
  execute(input: I, ctx: ToolContext): Promise<O>;
}

/**
 * Identity helper that exists only for type inference. Writing a `Tool` literal
 * directly forces the author to spell out `I` by hand; here `I` is inferred from
 * the `input` schema, so an unannotated `execute(input)` is typed as the schema's
 * output.
 *
 * Nothing is validated or wrapped at runtime: the tool is returned as given.
 */
export function defineTool<I, O>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}

/**
 * Converts a tool into the definition sent to an LLM provider, turning the Zod
 * `input` schema into JSON Schema for `parameters`.
 *
 * The schema is converted with `io: 'input'`: the model produces the arguments
 * before any Zod transform runs, so that is the shape it must be told about.
 * This also keeps schemas with transforms convertible.
 *
 * @throws If the schema contains something JSON Schema cannot represent, such as `z.date()`.
 */
export function toToolDefinition(
  tool: Pick<Tool, 'name' | 'description' | 'input'>,
): ToolDefinition {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(tool.input, { io: 'input' });
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: parameters,
    },
  };
}

export type ToolResult = ({ ok: true; output: unknown } | { ok: false; error: string }) & {
  durationMs: number;
};

export function toToolMessage(call: ToolCall, result: ToolResult): ToolMessage {
  if (!result.ok) {
    return {
      role: 'tool',
      tool_call_id: call.id,
      content: result.error,
    };
  }
  if (typeof result.output === 'string') {
    return {
      role: 'tool',
      tool_call_id: call.id,
      content: result.output,
    };
  }

  return {
    role: 'tool',
    tool_call_id: call.id,
    content: stringifyOutput(result.output),
  };
}

/** `message.content` must be a string, so a missing or unserializable output still yields one. */
function stringifyOutput(output: unknown): string {
  try {
    return JSON.stringify(output ?? null, null, 2) ?? String(output);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Tool succeeded but its output could not be serialized: ${reason}`;
  }
}
