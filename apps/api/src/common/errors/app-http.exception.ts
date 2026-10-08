import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@robux/shared';

/** An HTTP error with an explicit application error code and a client-safe message. */
export class AppHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message, status);
  }
}

export const invalidCredentials = () =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Email atau kata sandi salah.',
  );

export const authenticationRequired = () =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHORIZED,
    'Silakan masuk terlebih dahulu.',
  );

export const forbidden = () =>
  new AppHttpException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Akses ditolak.');

export const notFound = () =>
  new AppHttpException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Data tidak ditemukan.');

export const rateLimited = (retryAfterSeconds: number) =>
  new AppHttpException(
    HttpStatus.TOO_MANY_REQUESTS,
    ErrorCode.RATE_LIMITED,
    'Terlalu banyak percobaan. Silakan coba lagi nanti.',
    retryAfterSeconds,
  );
