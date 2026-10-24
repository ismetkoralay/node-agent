import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import { createAgent, InMemoryChatStore, type Logger, type ToolCall } from '@node-agent/core';
import { OllamaProvider } from '@node-agent/provider-ollama';
import { calculatorTool, getCurrentTimeTool } from '@node-agent/tools';

const SYSTEM_PROMPT = `You are Node Agent, a helpful assistant running in a terminal chat demo.
Always reply in the same language the user writes in.

Most messages do NOT need a tool. Answer greetings, small talk and questions about yourself directly, without calling any tool.
Examples that need no tool: "Hello, who are you?", "Thanks!", "What can you do?"

Call a tool only in these two cases:
- The user asks for the current time, date or day of the week: call get_current_time. Pass an IANA timezone such as "Europe/Istanbul" if a place is mentioned.
- The user asks for a calculation: call calculator, one step per call, instead of calculating in your head.

If a tool returns an error, fix your input and try once more.
Be concise. State tool results plainly, without JSON or tool names.
You can see the earlier messages of this conversation; use them when the user refers to them.`;

async function chat() {
  const rl = readline.createInterface({ input, output });
  // A pending rl.question never settles when the interface closes (Ctrl+D, end of piped input),
  // so the prompt races against this.
  const closed = new Promise<null>((resolve) => rl.once('close', () => resolve(null)));

  // The agent logs how long each tool call took; keep it by call id to print after the run.
  const durations = new Map<string, number>();
  const logger: Logger = {
    debug(message, meta) {
      if (message !== 'tools executed' || !meta) return;
      for (const r of meta.results as { id: string; durationMs: number }[]) {
        durations.set(r.id, r.durationMs);
      }
    },
    info() {},
    warn() {},
    error() {},
  };

  const store = new InMemoryChatStore();
  const agent = createAgent({
    model: process.env.LLM_MODEL ?? 'llama3.2',
    provider: new OllamaProvider({ baseUrl: process.env.OLLAMA_BASE_URL }),
    store,
    tools: [getCurrentTimeTool, calculatorTool],
    systemPrompt: SYSTEM_PROMPT,
    logger,
  });
  const conversation = await store.createConversation();

  console.log('Type "/exit" to leave. Ctrl+C cancels the current request.\n');

  while (true) {
    // Ctrl+C aborts whatever is running: the pending prompt or the agent request.
    const controller = new AbortController();
    const { signal } = controller;
    const onSigint = () => controller.abort();
    rl.on('SIGINT', onSigint);

    try {
      const line = await Promise.race([rl.question('you> ', { signal }), closed]);
      if (line === null || line.trim() === '/exit') break;
      if (line.trim() === '') continue;

      const result = await agent.run({
        conversationId: conversation.id,
        input: line,
        signal,
      });

      // Tool messages come right after the assistant message that asked for them.
      const calls = new Map<string, ToolCall>();
      for (const message of result.newMessages) {
        if (message.role === 'assistant') {
          for (const call of message.tool_calls ?? []) calls.set(call.id, call);
        } else if (message.role === 'tool') {
          const call = calls.get(message.tool_call_id);
          const ms = Math.round(durations.get(message.tool_call_id) ?? 0);
          const content = message.content.replace(/\s*\n\s*/g, ' ');
          console.log(
            `[tool] ${call?.function.name}(${call?.function.arguments}) → ${content} (${ms}ms)`,
          );
        }
      }

      console.log(`agent> ${result.message.content}`);
      const { promptTokens, completionTokens } = result.usage;
      console.log(
        `  [${result.steps} steps · tokens: ${promptTokens} in / ${completionTokens} out]`,
      );
    } catch (error) {
      if (signal.aborted) {
        console.log('\nCanceled.');
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
    } finally {
      rl.off('SIGINT', onSigint);
    }
  }

  rl.close();
}

await chat();
