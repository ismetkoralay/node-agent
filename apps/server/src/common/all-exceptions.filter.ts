import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConversationNotFoundError, ProviderError } from '@node-agent/core';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ConversationBusyError } from '../chat/conversation-busy.error.ts';
import { RequestValidationError } from './request-validation.error.ts';
import type { ValidationIssue } from './validation-issue.type.ts';

export type MappedException = {
  status: number;
  code: string;
  message: string;
  details?: ValidationIssue[];
};

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
};

const PROVIDER_UNAVAILABLE_MESSAGE = 'The language model is unavailable, try again later';
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * Turns any thrown value into the status, code and message the client gets. Pure, so each row of
 * the error table can be tested without HTTP. The order matters: domain errors first, then
 * body-parser errors, then Nest's own `HttpException`s, then everything else.
 */
export function mapException(exception: unknown): MappedException {
  if (exception instanceof RequestValidationError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'validation_error',
      message: 'Request validation failed',
      details: exception.issues,
    };
  }
  if (exception instanceof ConversationNotFoundError) {
    return {
      status: HttpStatus.NOT_FOUND,
      code: 'conversation_not_found',
      message: exception.message,
    };
  }
  if (exception instanceof ConversationBusyError) {
    return { status: HttpStatus.CONFLICT, code: 'conversation_busy', message: exception.message };
  }
  if (exception instanceof ProviderError) {
    // The provider's message and cause can contain internal addresses, so the client gets a fixed text.
    return {
      status: HttpStatus.BAD_GATEWAY,
      code: 'provider_unavailable',
      message: PROVIDER_UNAVAILABLE_MESSAGE,
    };
  }
  if (isBodyParserError(exception)) {
    return {
      status: exception.status,
      code: codeForStatus(exception.status),
      message: exception.message,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { status, code: codeForStatus(status), message: exception.message };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'internal_error',
    message: INTERNAL_ERROR_MESSAGE,
  };
}

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? 'http_error';
}

/** `status` and `type` are added at runtime by `http-errors` (body-parser, raw-body); `Error` has neither. */
type HttpError = Error & { status: number; type: string };

function isBodyParserError(e: unknown): e is HttpError {
  return (
    e instanceof Error &&
    'status' in e &&
    typeof e.status === 'number' &&
    'type' in e &&
    typeof e.type === 'string'
  );
}

/**
 * The single place where errors become responses. With `@Catch()` Nest's own handler is off, so
 * logging 5xx (with stack and cause) is this filter's job; 4xx are not logged here.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger() private readonly logger: PinoLogger) {
    logger.setContext('AllExceptionsFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    // Body-parser failures happen before pino-http assigns `req.id`, so fall back to a fresh one.
    const requestId = request.id ?? crypto.randomUUID();
    response.setHeader('x-request-id', requestId);

    const { status, code, message, details } = mapException(exception);
    if (status >= 500) {
      // The key must be `err` so pino's err serializer writes the stack and the `caused by` chain.
      this.logger.error({ err: exception }, message);
    }

    response
      .status(status)
      .json({ error: { code, message, requestId, ...(details && { details }) } });
  }
}
