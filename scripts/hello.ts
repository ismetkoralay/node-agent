import { OllamaProvider } from '@node-agent/provider-ollama';

const ollamaProvider = new OllamaProvider({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const model = process.env.LLM_MODEL ?? 'llama3.2';
const startedAt = performance.now();

ollamaProvider
  .chat({
    model: model,
    messages: [
      {
        role: 'system',
        content: 'You are a concise assistant. Answer in at most two sentences.',
      },
      {
        role: 'user',
        content:
          process.argv[2] ?? 'What is the difference between an LLM agent and a simple chatbot?',
      },
    ],
  })
  .then((res) => {
    const endedAt = performance.now();
    console.log('model:', model);
    console.log('Response:', res.message.content);
    let status = `finishReason: ${res.finishReason}`;
    if (res.usage != null) {
      status += `· tokens: ${res.usage.promptTokens} -> ${res.usage.completionTokens}`;
    }
    const elapsedTime = ((endedAt - startedAt) / 1000).toFixed(1);
    status += `· ${elapsedTime}s`;
    console.log(status);
  })
  .catch((err) => {
    console.error('Error during chat request:', err.message);
    process.exit(1);
  });
