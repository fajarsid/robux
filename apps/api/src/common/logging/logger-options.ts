import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/app-config';
import { REDACT_CENSOR, REDACT_PATHS } from './redact';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Accepts a well-formed upstream X-Request-Id (set by Nginx), otherwise generates one. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * The guest tracking token is a credential carried in the path (`/track/:token`). Nginx masks it in
 * its own access log, but the frontend container calls the API directly, so the API must mask it too.
 */
const TRACKING_TOKEN_SEGMENT = /(\/track\/)[^/?#]+/g;

export function maskSensitivePath(url: string): string {
  return url.replace(TRACKING_TOKEN_SEGMENT, `$1${REDACT_CENSOR}`);
}

/** Shared pino settings for HTTP and non-HTTP processes. */
export function basePinoOptions(config: AppConfig) {
  return {
    level: config.logLevel,
    base: { service: config.service },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    messageKey: 'message',
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
  };
}

export function buildLoggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      ...basePinoOptions(config),
      genReqId: resolveRequestId,
      customAttributeKeys: { reqId: 'requestId', responseTime: 'durationMs' },
      // Health probes run every few seconds; logging them adds noise without value.
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          url: maskSensitivePath(req.url),
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
