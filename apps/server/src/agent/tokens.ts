// Interfaces vanish at runtime, so Nest needs a runtime key to inject them.
// Symbols are unique (no clash with a same-named string token) and must be imported (typos fail at compile time).

/** The LLMProvider the agent talks to (Ollama in prod, FakeProvider in tests). */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
/** The Tools that can be used by models(e.g. getCurrentTimeTool). */
export const TOOLS = Symbol('TOOLS');
/** The ChatStore is where we store the user-model conversation(e.g. InMemoryChatStore). */
export const CHAT_STORE = Symbol('CHAT_STORE');
/** The Agent is what manages models calls, tool calls etc. */
export const AGENT = Symbol('AGENT');
