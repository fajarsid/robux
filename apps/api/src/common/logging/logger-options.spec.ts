import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import pinoHttp, { type Options } from 'pino-http';
import request from 'supertest';
import { generateGuestTrackingToken } from '../../modules/orders/domain/guest-tracking-token';
import type { AppConfig } from '../../config/app-config';
import { buildLoggerParams, maskSensitivePath } from './logger-options';
import { REDACT_CENSOR } from './redact';

/** A server whose request logging uses exactly the API's pino-http settings. */
function loggedServer() {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const config = { logLevel: 'info', service: 'api' } as AppConfig;
  const options = buildLoggerParams(config).pinoHttp as Options;
  const logRequest = pinoHttp(options, stream);
  const server = createServer((req, res) => {
    logRequest(req, res);
    res.statusCode = 404;
    res.end();
  });
  return { server, output: () => output };
}

describe('HTTP request logging', () => {
  it.each(['', '/cancel', '/payments'])(
    'never writes a guest tracking token into the log (/track/:token%s)',
    async (suffix) => {
      const { token } = generateGuestTrackingToken();
      const { server, output } = loggedServer();
      await request(server).get(`/api/v1/track/${token}${suffix}`);

      const log = output();
      expect(log).toContain(`/api/v1/track/${REDACT_CENSOR}${suffix}`);
      expect(log).not.toContain(token);
      expect(log).not.toContain(token.slice(0, 12));
    },
  );

  it('keeps ordinary paths readable', () => {
    expect(maskSensitivePath('/api/v1/products/robux-500/quote?quantity=2')).toBe(
      '/api/v1/products/robux-500/quote?quantity=2',
    );
  });

  it('redacts the idempotency key and CSRF headers', async () => {
    const { server, output } = loggedServer();
    const idempotencyKey = generateGuestTrackingToken().token;
    await request(server)
      .post('/api/v1/orders')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-CSRF-Token', 'csrf-value-for-test');
    // The request serializer logs no headers at all; this guards against a future serializer change.
    expect(output()).not.toContain(idempotencyKey);
    expect(output()).not.toContain('csrf-value-for-test');
  });
});
