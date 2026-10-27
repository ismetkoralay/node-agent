import { type ArgumentMetadata, BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    let parsedValue: unknown;
    try {
      parsedValue = this.schema.parse(value);
      return parsedValue;
    } catch (error) {
      let message: string = '';
      if (error instanceof ZodError) {
        message = `${error.issues[0]?.message}: ${error.issues[0]?.path[0]?.toString()}`;
      } else {
        message = `Schema validation is failed for: ${typeof value}`;
      }
      throw new BadRequestException(message, {
        cause: error,
      });
    }
  }
}
