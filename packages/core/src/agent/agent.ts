import type { ChatStore } from '../memory/chat_store.ts';
import type { LLMProvider } from '../provider/llm_provider.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { type Logger, type Tool, toToolMessage } from '../tools/tool.ts';
import type { AssistantMessage, Message, ToolCall } from '../types/index.ts';

const DEFAULT_MAX_STEPS = 8;

/**
 * Options an agent expects at creation
 */
export type AgentOptions = {
  /** Which provider the agent talks to */
  provider: LLMProvider;
  /** The model to be called */
  model: string;
  /** The list of tools that the agent can call. @default [] */
  tools?: Tool[];
  /** Store that keeps the chat history */
  store: ChatStore;
  /** System prompt that is put in front of every request; never stored */
  systemPrompt?: string;
  /** Max number of provider calls in one run. @default 8 */
  maxSteps?: number;
  /** Receives a debug entry per step; silent when omitted */
  logger?: Logger;
};

/**
 * Inputs an agent expects
 */
export type AgentRunInput = {
  /** Current conversation ID */
  conversationId: string;
  /** User input */
  input: string;
  /** Abort signal */
  signal?: AbortSignal;
};

/**
 * Why a run ended
 */
export type AgentFinishReason = 'stop' | 'length' | 'max_steps';

/**
 * Represents the result of an agent run
 */
export type AgentRunResult = {
  /** Latest assistant message */
  message: AssistantMessage;
  /** All messages generated during this run; exactly what was appended to the store */
  newMessages: Message[];
  /** How many times provider.chat was called */
  steps: number;
  /** Token usage summed over all steps */
  usage: { promptTokens: number; completionTokens: number };
  /** Why the run ended */
  finishReason: AgentFinishReason;
};

/**
 * Represents what an agent can do
 */
export interface Agent {
  /**
   * Runs the agent loop: call the model, run the tools it asks for, feed the results back,
   * and stop when it answers. The turn is appended to the store in one go at the end, so a run
   * that rejects (provider error, abort) leaves the conversation untouched.
   */
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

class AgentImpl implements Agent {
  readonly #provider: LLMProvider;
  readonly #model: string;
  readonly #store: ChatStore;
  readonly #registry: ToolRegistry;
  readonly #systemPrompt: string | undefined;
  readonly #maxSteps: number;
  readonly #logger: Logger;

  constructor(options: AgentOptions) {
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError(`maxSteps must be a positive integer, got ${maxSteps}`);
    }
    this.#provider = options.provider;
    this.#model = options.model;
    this.#store = options.store;
    this.#registry = new ToolRegistry(options.tools ?? []);
    this.#systemPrompt = options.systemPrompt;
    this.#maxSteps = maxSteps;
    this.#logger = options.logger ?? silentLogger;
  }

  async run({ conversationId, input, signal }: AgentRunInput): Promise<AgentRunResult> {
    const history = await this.#store.getMessages(conversationId);
    const newMessages: Message[] = [{ role: 'user', content: input }];
    const usage = { promptTokens: 0, completionTokens: 0 };
    // Tools always expect a signal, so a run without one gets a signal that never fires.
    const toolSignal = signal ?? new AbortController().signal;
    const definitions = this.#registry.definitions();

    let finishReason: AgentFinishReason = 'max_steps';
    let last: AssistantMessage | undefined;
    let steps = 0;

    while (steps < this.#maxSteps) {
      signal?.throwIfAborted();
      steps++;

      const response = await this.#provider.chat(
        {
          model: this.#model,
          messages: this.#buildMessages(history, newMessages),
          ...(definitions.length > 0 && { tools: definitions }),
        },
        { signal },
      );
      if (response.usage) {
        usage.promptTokens += response.usage.promptTokens;
        usage.completionTokens += response.usage.completionTokens;
      }
      last = response.message;
      newMessages.push(last);

      const calls = last.tool_calls ?? [];
      this.#logger.debug('agent step', {
        step: steps,
        finishReason: response.finishReason,
        toolCalls: calls.map((call) => call.function.name),
      });

      if (calls.length === 0) {
        finishReason = response.finishReason === 'length' ? 'length' : 'stop';
        break;
      }

      // Tools run even on the last step: every tool call in the store needs its result.
      const toolMessages = await this.#executeToolCalls(steps, calls, conversationId, toolSignal);
      // A cancelled tool reports ok: false instead of throwing, so check here or the model
      // would be called once more with "aborted" errors.
      signal?.throwIfAborted();
      newMessages.push(...toolMessages);
    }

    await this.#store.appendMessages(conversationId, newMessages);

    // maxSteps >= 1 guarantees at least one iteration.
    return { message: last as AssistantMessage, newMessages, steps, usage, finishReason };
  }

  #buildMessages(history: Message[], newMessages: Message[]): Message[] {
    const system: Message[] = this.#systemPrompt
      ? [{ role: 'system', content: this.#systemPrompt }]
      : [];
    return [...system, ...history, ...newMessages];
  }

  /** Runs the calls concurrently; `Promise.all` keeps the results in call order. */
  async #executeToolCalls(
    step: number,
    calls: ToolCall[],
    conversationId: string,
    signal: AbortSignal,
  ): Promise<Message[]> {
    const ctx = { signal, conversationId, logger: this.#logger };
    const results = await Promise.all(calls.map((call) => this.#registry.execute(call, ctx)));

    this.#logger.debug('tools executed', {
      step,
      results: results.map((result, i) => ({
        name: calls[i]?.function.name,
        ok: result.ok,
        durationMs: result.durationMs,
      })),
    });

    return results.map((result, i) => toToolMessage(calls[i] as ToolCall, result));
  }
}

export function createAgent(options: AgentOptions): Agent {
  return new AgentImpl(options);
}
