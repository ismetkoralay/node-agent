import { z } from 'zod';
import { ToolError } from '../errors/tool_error.ts';
import type { ToolCall, ToolDefinition } from '../types/index.ts';
import { type Tool, type ToolContext, type ToolResult, toToolDefinition } from './tool.ts';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  private register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new ToolError(
        `Tool with name "${tool.name}" is already registered.`,
        'tool_already_registered',
      );
    }
    this.tools.set(tool.name, tool);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => toToolDefinition(tool));
  }

  /**
   * Runs a tool call and reports every failure as `ok: false` instead of throwing, so the
   * model sees the problem on its next turn and can correct itself.
   */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const name = call.function.name;

    if (ctx.signal.aborted) {
      return fail(`Execution of tool "${name}" was aborted${abortReason(ctx.signal)}.`);
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return fail(
        `Tool with name "${name}" is not registered. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
      );
    }

    let args: unknown;
    try {
      // Some models send an empty string for a call without arguments.
      const raw = call.function.arguments.trim();
      args = JSON.parse(raw === '' ? '{}' : raw);
    } catch (error) {
      return fail(`Invalid JSON arguments for tool "${name}": ${errorMessage(error)}`);
    }

    // safeParseAsync still rejects when a transform throws or an async refinement fails.
    let input: unknown;
    try {
      const parsed = await tool.input.safeParseAsync(args);
      if (!parsed.success) {
        return fail(`Invalid input for tool "${name}":\n${z.prettifyError(parsed.error)}`);
      }
      input = parsed.data;
    } catch (error) {
      return fail(`Invalid input for tool "${name}": ${errorMessage(error)}`);
    }

    const startTime = performance.now();
    try {
      const output = await tool.execute(input, ctx);
      return { ok: true, output, durationMs: performance.now() - startTime };
    } catch (error) {
      return fail(errorMessage(error), performance.now() - startTime);
    }
  }
}

function fail(error: string, durationMs = 0): ToolResult {
  return { ok: false, error, durationMs };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason === undefined) return '';
  // The default reason is a generic "AbortError", which tells the model nothing.
  if (reason instanceof DOMException && reason.name === 'AbortError') return '';
  return ` (${errorMessage(reason)})`;
}
