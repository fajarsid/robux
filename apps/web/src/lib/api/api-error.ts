import type { ErrorCode } from '@robux/shared';

/** An API failure carrying the server's error code; UI copy comes from the `errors` messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
  }
}
