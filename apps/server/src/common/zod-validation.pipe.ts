import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { RequestValidationError } from './request-validation.error.ts';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      // `@Param('id', pipe)` gives `metadata.data === 'id'`; a body has no name, so no prefix.
      const prefix = metadata.data ? [metadata.data] : [];
      const issues = parsed.error.issues.map((issue) => ({
        path: [...prefix, ...issue.path.map(String)].join('.'),
        message: issue.message,
      }));
      throw new RequestValidationError('Request validation failed', issues, {
        cause: parsed.error,
      });
    }

    return parsed.data;
  }
}
