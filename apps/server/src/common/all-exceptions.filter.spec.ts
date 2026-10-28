import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { AgentError, ConversationNotFoundError, ProviderError } from '@node-agent/core';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, test, vi } from 'vitest';
import { ConversationBusyError } from '../chat/conversation-busy.error.ts';
import { AllExceptionsFilter, mapException } from './all-exceptions.filter.ts';
import { RequestValidationError } from './request-validation.error.ts';

/** What body-parser throws: not an `HttpException`, but `http-errors` adds `status` and `type`. */
function bodyParserError(message: string, status: number, type: string): Error {
  return Object.assign(new Error(message), { status, statusCode: status, type, expose: true });
}

describe('mapException', () => {
  test('maps RequestValidationError to 400 validation_error with details', () => {
    const issues = [{ path: 'content', message: 'Invalid input: expected string' }];

    expect(mapException(new RequestValidationError('zod message', issues))).toStrictEqual({
      status: 400,
      code: 'validation_error',
      message: 'Request validation failed',
      details: issues,
    });
  });

  test('maps ConversationNotFoundError to 404 conversation_not_found', () => {
    const err = new ConversationNotFoundError('c-1');

    expect(mapException(err)).toStrictEqual({
      status: 404,
      code: 'conversation_not_found',
      message: err.message,
    });
  });

  test('maps ConversationBusyError to 409 conversation_busy', () => {
    const err = new ConversationBusyError('c-1');

    expect(mapException(err)).toStrictEqual({
      status: 409,
      code: 'conversation_busy',
      message: err.message,
    });
  });

  test('maps ProviderError to 502 with a fixed message that hides the original one', () => {
    const err = new ProviderError('Could not reach Ollama: fetch failed', {
      provider: 'ollama',
      retryable: true,
      cause: new Error('connect ECONNREFUSED 127.0.0.1:11999'),
    });

    const mapped = mapException(err);

    expect(mapped).toStrictEqual({
      status: 502,
      code: 'provider_unavailable',
      message: 'The language model is unavailable, try again later',
    });
    expect(JSON.stringify(mapped)).not.toContain('ECONNREFUSED');
  });

  test('maps an oversized body to 413 payload_too_large', () => {
    const err = bodyParserError('request entity too large', 413, 'entity.too.large');

    expect(mapException(err)).toStrictEqual({
      status: 413,
      code: 'payload_too_large',
      message: 'request entity too large',
    });
  });

  test('maps other body-parser errors by their own status', () => {
    const err = bodyParserError('Unexpected token', 400, 'entity.parse.failed');

    expect(mapException(err)).toStrictEqual({
      status: 400,
      code: 'bad_request',
      message: 'Unexpected token',
    });
  });

  test.each([
    ['BadRequestException', new BadRequestException('bad json'), 400, 'bad_request'],
    ['NotFoundException', new NotFoundException('Cannot GET /nope'), 404, 'not_found'],
    ['ForbiddenException', new ForbiddenException('nope'), 403, 'forbidden'],
    ['ConflictException', new ConflictException('dup'), 409, 'conflict'],
    ['401', new HttpException('who are you', 401), 401, 'unauthorized'],
    ['405', new HttpException('wrong method', 405), 405, 'method_not_allowed'],
    ['415', new HttpException('wrong type', 415), 415, 'unsupported_media_type'],
    ['429', new HttpException('slow down', 429), 429, 'too_many_requests'],
    ['unlisted status', new HttpException('teapot', 418), 418, 'http_error'],
  ])('maps HttpException (%s) by its status', (_name, err, status, code) => {
    expect(mapException(err)).toStrictEqual({ status, code, message: err.message });
  });

  test('maps an unlisted 5xx HttpException to its own status and http_error', () => {
    expect(mapException(new HttpException('overloaded', 503))).toMatchObject({
      status: 503,
      code: 'http_error',
    });
  });

  test.each([
    ['a TypeError', new TypeError('secret')],
    ['an AgentError that is not mapped', new AgentError('secret', 'some_code')],
    ['a thrown string', 'secret'],
    ['undefined', undefined],
  ])('maps %s to 500 internal_error with a fixed message', (_name, err) => {
    const mapped = mapException(err);

    expect(mapped).toStrictEqual({
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    });
    expect(JSON.stringify(mapped)).not.toContain('secret');
  });

  test('checks RequestValidationError before the body-parser guard', () => {
    const err = Object.assign(new RequestValidationError('x', []), { status: 413, type: 'x' });

    expect(mapException(err).code).toBe('validation_error');
  });
});

describe('AllExceptionsFilter', () => {
  function setup(req: { id?: string } = {}) {
    const logger = { setContext: vi.fn(), error: vi.fn() };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const setHeader = vi.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ status, setHeader }),
      }),
    };
    const filter = new AllExceptionsFilter(logger as unknown as PinoLogger);
    const run = (exception: unknown) => filter.catch(exception, host as never);
    /** The `error` object of the first JSON body written. */
    const sentError = () => json.mock.calls[0]?.[0]?.error;
    return { logger, json, status, setHeader, run, sentError };
  }

  test('sets its logger context', () => {
    const { logger } = setup();

    expect(logger.setContext).toHaveBeenCalledWith('AllExceptionsFilter');
  });

  test('writes the error envelope with the request id and mirrors it in the header', () => {
    const { run, status, json, setHeader } = setup({ id: 'req-1' });

    run(new ConversationNotFoundError('c-1'));

    expect(status).toHaveBeenCalledWith(404);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'req-1');
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'conversation_not_found',
        message: 'Conversation c-1 not found',
        requestId: 'req-1',
      },
    });
  });

  test('includes details for validation errors', () => {
    const { run, sentError } = setup({ id: 'req-1' });
    const issues = [{ path: 'content', message: 'Required' }];

    run(new RequestValidationError('x', issues));

    expect(sentError()).toMatchObject({ code: 'validation_error', details: issues });
  });

  test('has no details key outside validation errors', () => {
    const { run, sentError } = setup({ id: 'req-1' });

    run(new Error('boom'));

    expect(sentError()).not.toHaveProperty('details');
  });

  test('generates a request id and sets the header when the request has none', () => {
    const { run, sentError, setHeader } = setup();

    run(bodyParserError('request entity too large', 413, 'entity.too.large'));

    const { requestId } = sentError();
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', requestId);
  });

  test('logs a ProviderError under the err key and keeps its message out of the response', () => {
    const { run, logger, json } = setup({ id: 'req-1' });
    const err = new ProviderError('Could not reach Ollama: fetch failed', {
      provider: 'ollama',
      retryable: true,
      cause: new Error('connect ECONNREFUSED 127.0.0.1:11999'),
    });

    run(err);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toStrictEqual({ err });
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toMatch(/ECONNREFUSED|Ollama|fetch failed/);
  });

  test('logs an unknown error but does not leak it', () => {
    const { run, logger, json } = setup({ id: 'req-1' });
    const err = new Error('secret');

    run(err);

    expect(logger.error.mock.calls[0]?.[0]).toStrictEqual({ err });
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toContain('secret');
  });

  test('logs a 5xx HttpException', () => {
    const { run, logger } = setup({ id: 'req-1' });
    const err = new HttpException('overloaded', 503);

    run(err);

    expect(logger.error.mock.calls[0]?.[0]).toStrictEqual({ err });
  });

  test.each([
    ['validation error', new RequestValidationError('x', [])],
    ['not found', new ConversationNotFoundError('c-1')],
    ['busy', new ConversationBusyError('c-1')],
    ['HttpException 404', new NotFoundException('Cannot GET /nope')],
    ['payload too large', bodyParserError('request entity too large', 413, 'entity.too.large')],
  ])('does not log %s', (_name, err) => {
    const { run, logger } = setup({ id: 'req-1' });

    run(err);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
