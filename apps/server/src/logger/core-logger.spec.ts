import type { Logger } from '@node-agent/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { type PinoLike, toCoreLogger } from './core-logger.ts';

describe('logger adapter', () => {
  let fakePino: PinoLike;
  let logger: Logger;
  beforeEach(() => {
    fakePino = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    logger = toCoreLogger(fakePino);
  });

  test('successfully redirects info logs with meta', () => {
    logger.info('info', { a: 'b' });

    expect(fakePino.info).toHaveBeenCalledWith({ a: 'b' }, 'info');
  });

  test('successfully redirects info logs without meta', () => {
    logger.info('info');

    expect(fakePino.info).toHaveBeenCalledWith({}, 'info');
  });

  test('successfully redirects debug logs with meta', () => {
    logger.debug('debug', { a: 'b' });

    expect(fakePino.debug).toHaveBeenCalledWith({ a: 'b' }, 'debug');
  });

  test('successfully redirects info debug without meta', () => {
    logger.debug('debug');

    expect(fakePino.debug).toHaveBeenCalledWith({}, 'debug');
  });

  test('successfully redirects warn logs with meta', () => {
    logger.warn('warn', { a: 'b' });

    expect(fakePino.warn).toHaveBeenCalledWith({ a: 'b' }, 'warn');
  });

  test('successfully redirects warn logs without meta', () => {
    logger.warn('warn');

    expect(fakePino.warn).toHaveBeenCalledWith({}, 'warn');
  });

  test('successfully redirects error logs with meta', () => {
    logger.error('error', { a: 'b' });

    expect(fakePino.error).toHaveBeenCalledWith({ a: 'b' }, 'error');
  });

  test('successfully redirects error logs without meta', () => {
    logger.error('error');

    expect(fakePino.error).toHaveBeenCalledWith({}, 'error');
  });
});
