import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { RequestValidationError } from './request-validation.error.ts';
import { ZodValidationPipe } from './zod-validation.pipe.ts';

const BODY: ArgumentMetadata = { type: 'body', data: undefined };

/** Runs the pipe on input it must reject and returns the error it threw. */
function rejection(
  schema: z.ZodType,
  value: unknown,
  metadata: ArgumentMetadata = BODY,
): RequestValidationError {
  try {
    new ZodValidationPipe(schema).transform(value, metadata);
  } catch (err) {
    expect(err).toBeInstanceOf(RequestValidationError);
    return err as RequestValidationError;
  }
  return expect.unreachable('expected the pipe to throw');
}

describe('Zod Validation Pipe', () => {
  describe('valid input', () => {
    test('returns a valid value', () => {
      const res = new ZodValidationPipe(z.uuid()).transform(
        '6f1c0d3e-8f0a-4c52-9a43-2d4b7a1e5c90',
        { type: 'param', data: 'id' },
      );

      expect(res).toBe('6f1c0d3e-8f0a-4c52-9a43-2d4b7a1e5c90');
    });

    test('returns what Zod parsed, not the raw input: unknown keys dropped, defaults applied', () => {
      const schema = z.object({ title: z.string(), retries: z.number().default(3) });

      const res = new ZodValidationPipe(schema).transform({ title: 't', extra: 'x' }, BODY);

      expect(res).toStrictEqual({ title: 't', retries: 3 });
    });
  });

  describe('invalid input', () => {
    test('throws RequestValidationError and keeps the Zod error as cause', () => {
      const err = rejection(z.object({ content: z.string() }), {});

      expect(err.cause).toBeInstanceOf(z.ZodError);
    });

    test('reports every issue, not just the first', () => {
      const err = rejection(z.object({ a: z.string(), b: z.number() }), {});

      expect(err.issues.map((i) => i.path)).toStrictEqual(['a', 'b']);
    });

    test('joins nested paths with dots', () => {
      const err = rejection(z.object({ metadata: z.record(z.string(), z.string()) }), {
        metadata: { a: 1 },
      });

      expect(err.issues).toStrictEqual([{ path: 'metadata.a', message: expect.any(String) }]);
    });

    test('prefixes the path with the parameter name', () => {
      const err = rejection(z.uuid(), 'abc', { type: 'param', data: 'id' });

      expect(err.issues).toStrictEqual([{ path: 'id', message: 'Invalid UUID' }]);
    });

    test('uses an empty path when the whole body is invalid and there is no parameter name', () => {
      const err = rejection(z.object({ a: z.string() }), undefined);

      expect(err.issues).toStrictEqual([{ path: '', message: expect.any(String) }]);
    });
  });
});
