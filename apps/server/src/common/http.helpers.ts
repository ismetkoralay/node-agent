import { applyDecorators, HttpCode, SerializeOptions } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { z } from 'zod';

/**
 * Declares a success response once for all three consumers: the status code, the serializer that
 * validates the real response against `schema`, and the Swagger entry. Swagger does not read
 * `@SerializeOptions`, so the schema has to be handed to both decorators.
 */
export function ApiResult(status: number, description: string, schema: z.ZodType) {
  return applyDecorators(
    HttpCode(status),
    SerializeOptions({ schema }),
    ApiResponse({ status, description, standardSchema: schema }),
  );
}
