import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiErrorBody, ErrorCode } from '@robux/shared';
import type { Request, Response } from 'express';
import { AppHttpException } from './app-http.exception';
import { DOMAIN_ERROR_STATUS, DomainError } from './domain-error';
import { resolveRequestId } from '../logging/logger-options';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.DUPLICATE_REQUEST,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

/**
 * Express body-parser rejects oversized or malformed bodies before Nest sees the request; those
 * errors carry `type` and a 4xx `status` and must not surface as 500s.
 */
function bodyParserErrorStatus(exception: unknown): number | undefined {
  const candidate = exception as { type?: unknown; status?: unknown };
  return typeof candidate?.type === 'string' &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500
    ? candidate.status
    : undefined;
}

const GENERIC_MESSAGE = 'Terjadi kesalahan pada sistem. Silakan coba lagi.';

/**
 * Converts every error into `{ code, message, requestId }`. Internal details (stack traces,
 * SQL errors, provider responses) are logged server-side and never returned (PRD §59).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    // Errors raised before the logging middleware (e.g. body parser limits) have no id yet.
    const requestId = String(req.id ?? (req.id = resolveRequestId(req, res)));

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let message = GENERIC_MESSAGE;

    const bodyParserStatus = bodyParserErrorStatus(exception);
    if (bodyParserStatus !== undefined) {
      status = bodyParserStatus;
      code = status === 413 ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.VALIDATION_FAILED;
      message = status === 413 ? 'Data terlalu besar.' : 'Format data tidak valid.';
    } else if (exception instanceof DomainError) {
      status = DOMAIN_ERROR_STATUS[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        exception instanceof AppHttpException
          ? exception.code
          : (STATUS_TO_CODE[status] ??
            (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED));
      if (status < 500) {
        message = exception.message;
      }
      if (exception instanceof AppHttpException && exception.retryAfterSeconds !== undefined) {
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId, event: 'http.unhandled_error' });
    }

    const body: ApiErrorBody = { code, message, requestId };
    res.status(status).json(body);
  }
}
