import { toToolDefinition } from '@node-agent/core';
import { OllamaProvider } from '@node-agent/provider-ollama';
import { getCurrentTimeTool } from '@node-agent/tools';

const provider = new OllamaProvider({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const model = process.env.LLM_MODEL ?? 'llama3.2';
const args = process.argv.slice(2);
// `--tool` offers the model get_current_time, to see a tool call arrive as a stream chunk.
const withTool = args.includes('--tool');
const prompt = args.find((arg) => arg !== '--tool');
const startedAt = performance.now();

try {
  console.log('model:', model);
  let finishReason: string | undefined;
  let usage: { promptTokens: number; completionTokens: number } | undefined;

  for await (const chunk of provider.stream({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a concise assistant. Answer in at most two sentences.',
      },
      {
        role: 'user',
        content: prompt ?? 'What is the difference between an LLM agent and a simple chatbot?',
      },
    ],
    ...(withTool && { tools: [toToolDefinition(getCurrentTimeTool)] }),
  })) {
    switch (chunk.type) {
      case 'text.delta':
        process.stdout.write(chunk.text);
        break;
      case 'tool_call':
        process.stdout.write(
          `\n[tool_call] ${chunk.toolCall.function.name}(${chunk.toolCall.function.arguments})\n`,
        );
        break;
      case 'finish':
        finishReason = chunk.finishReason;
        usage = chunk.usage;
        break;
    }
  }

  const elapsedTime = ((performance.now() - startedAt) / 1000).toFixed(1);
  let status = `finishReason: ${finishReason}`;
  if (usage != null) {
    status += ` · tokens: ${usage.promptTokens} -> ${usage.completionTokens}`;
  }
  status += ` · ${elapsedTime}s`;
  console.log(`\n${status}`);
} catch (err) {
  console.error('Error during stream request:', err instanceof Error ? err.message : err);
  process.exit(1);
}
