import type { Message } from '../types/message.ts';

export const MAX_TITLE_LENGTH = 50;

/**
 * The title an untitled conversation gets: the first `MAX_TITLE_LENGTH` characters of the first
 * user message, with runs of whitespace collapsed and no whitespace left at either end. `undefined` when there is no usable user message.
 * Counted in code points, so an emoji is never cut in half.
 */
export function titleFromMessages(messages: readonly Message[]): string | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = message.content.replace(/\s+/g, ' ').trim();
    if (text) return Array.from(text).slice(0, MAX_TITLE_LENGTH).join('').trimEnd();
  }
  return undefined;
}
