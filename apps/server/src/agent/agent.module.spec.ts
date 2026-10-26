import { Test } from '@nestjs/testing';
import type { Agent, ChatStore } from '@node-agent/core';
import { FakeProvider, textResponse } from '@node-agent/core/testing';
import { LoggerModule } from 'nestjs-pino';
import { describe, expect, test } from 'vitest';
import { EnvModule } from '../config/env.module.ts';
import { AgentModule } from './agent.module.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';
import { AGENT, CHAT_STORE, LLM_PROVIDER } from './tokens.ts';

describe('Agent module', () => {
  test('agent module works with fake provider', async () => {
    const fake = new FakeProvider([textResponse('hello from fake provider')]);
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }), AgentModule],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fake)
      .compile();

    const agent = moduleRef.get<Agent>(AGENT);
    const chatStore = moduleRef.get<ChatStore>(CHAT_STORE);

    const conv = await chatStore.createConversation();
    const res = await agent.run({
      conversationId: conv.id,
      input: 'hello',
    });

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.messages[0]?.content).toBe(SYSTEM_PROMPT);
    expect(fake.requests[0]?.messages[1]?.content).toBe('hello');
    expect(fake.requests[0]?.model).toBe('qwen2.5:7b');

    expect(res.finishReason).toBe('stop');
    expect(res.message).toMatchObject({
      role: 'assistant',
      content: 'hello from fake provider',
    });
  });
});
