import { describe, expect, test } from 'vitest';
import { MAX_TITLE_LENGTH, titleFromMessages } from './conversation_title.ts';

describe('titleFromMessages', () => {
  test('uses the first user message', () => {
    expect(
      titleFromMessages([
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'first question' },
        { role: 'user', content: 'second question' },
      ]),
    ).toBe('first question');
  });

  test('is undefined without a user message', () => {
    expect(titleFromMessages([])).toBeUndefined();
    expect(titleFromMessages([{ role: 'assistant', content: 'hi' }])).toBeUndefined();
  });

  test('skips a user message that is only whitespace', () => {
    expect(
      titleFromMessages([
        { role: 'user', content: ' \n\t ' },
        { role: 'user', content: 'real' },
      ]),
    ).toBe('real');
  });

  test('cuts at MAX_TITLE_LENGTH characters', () => {
    const title = titleFromMessages([{ role: 'user', content: 'a'.repeat(200) }]);

    expect(MAX_TITLE_LENGTH).toBe(50);
    expect(title).toBe('a'.repeat(50));
  });

  test('keeps a message of exactly MAX_TITLE_LENGTH characters whole', () => {
    const content = 'b'.repeat(MAX_TITLE_LENGTH);

    expect(titleFromMessages([{ role: 'user', content }])).toBe(content);
  });

  test('collapses whitespace and trims before cutting', () => {
    expect(titleFromMessages([{ role: 'user', content: '  hello \n\n  big\tworld  ' }])).toBe(
      'hello big world',
    );
  });

  test('does not end in whitespace when the cut falls after a space', () => {
    const title = titleFromMessages([{ role: 'user', content: 'word '.repeat(30) }]);

    expect(title).toBe('word '.repeat(10).trimEnd());
  });

  test('never splits a surrogate pair', () => {
    const title = titleFromMessages([{ role: 'user', content: '😀'.repeat(60) }]);

    expect(Array.from(title ?? '')).toHaveLength(50);
    expect(title).toBe('😀'.repeat(50));
  });
});
