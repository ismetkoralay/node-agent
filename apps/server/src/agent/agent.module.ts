import { Module } from '@nestjs/common';
import { type ChatStore, createAgent, type LLMProvider, type Tool } from '@node-agent/core';
import { OllamaProvider } from '@node-agent/provider-ollama';
import { PinoLogger } from 'nestjs-pino';
import { ChatStoreModule } from '../chat-store/chat-store.module.ts';
import { EnvService } from '../config/env.service.ts';
import { toCoreLogger } from '../logger/core-logger.ts';
import { ToolsModule } from '../tools/tools.module.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';
import { AGENT, CHAT_STORE, LLM_PROVIDER, TOOLS } from './tokens.ts';

@Module({
  imports: [ToolsModule, ChatStoreModule],
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [EnvService],
      useFactory: (env: EnvService) => new OllamaProvider({ baseUrl: env.get('OLLAMA_BASE_URL') }),
    },
    {
      provide: AGENT,
      inject: [EnvService, LLM_PROVIDER, TOOLS, CHAT_STORE, PinoLogger],
      useFactory: (
        env: EnvService,
        llmProvider: LLMProvider,
        tools: Tool[],
        chatStore: ChatStore,
        logger: PinoLogger,
      ) => {
        logger.setContext('AGENT');
        return createAgent({
          model: env.get('LLM_MODEL'),
          provider: llmProvider,
          store: chatStore,
          logger: toCoreLogger(logger),
          maxSteps: env.get('AGENT_MAX_STEPS'),
          tools: tools,
          systemPrompt: SYSTEM_PROMPT,
        });
      },
    },
  ],
  exports: [AGENT, ChatStoreModule],
})
export class AgentModule {}
