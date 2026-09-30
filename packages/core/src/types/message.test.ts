import { expectTypeOf, test } from 'vitest';
import type { AssistantMessage, Message, ToolMessage } from '../index.ts';

const accept = (_m: Message) => {};

test('narrowing on role=tool exposes tool_call_id but not tool_calls', () => {
  const check = (m: Message) => {
    if (m.role === 'tool') {
      expectTypeOf(m).toEqualTypeOf<ToolMessage>();
      expectTypeOf(m.tool_call_id).toBeString();
      expectTypeOf(m).not.toHaveProperty('tool_calls');
    }
  };
  check({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
});

test('narrowing on role=assistant exposes nullable content and tool_calls', () => {
  const check = (m: Message) => {
    if (m.role === 'assistant') {
      expectTypeOf(m).toEqualTypeOf<AssistantMessage>();
      expectTypeOf(m.content).toEqualTypeOf<string | null>();
      expectTypeOf(m).toHaveProperty('tool_calls');
    }
  };
  check({ role: 'assistant', content: null });
});

test('a user message without content is not a Message', () => {
  expectTypeOf<{ role: 'user' }>().not.toExtend<Message>();
  // @ts-expect-error content is required
  accept({ role: 'user' });
});

test('a tool message without tool_call_id is not a Message', () => {
  expectTypeOf<{ role: 'tool'; content: string }>().not.toExtend<Message>();
  // @ts-expect-error tool_call_id is required
  accept({ role: 'tool', content: 'x' });
});
