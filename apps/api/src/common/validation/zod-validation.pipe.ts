import { HttpStatus, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';
import type { ZodType } from 'zod';
import { AppHttpException } from '../errors/app-http.exception';

/** Validates a request body against a shared zod schema. Field details stay server-side. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `Data tidak valid: ${fields.join(', ') || 'body'}`,
      );
    }
    return result.data;
  }
}
