import pino from 'pino';
import { Writable } from 'node:stream';
import { REDACT_CENSOR, REDACT_PATHS } from './redact';

function capture(): { logger: pino.Logger; lines: () => string } {
  let out = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } }, stream);
  return { logger, lines: () => out };
}

describe('log redaction', () => {
  it('removes secrets at top level and nested', () => {
    const { logger, lines } = capture();
    logger.info({
      password: 'hunter2',
      provider: { apiKey: 'k-123', credentials: { token: 't-1' } },
      payload: { nested: { signature: 'sig-abc' } },
    });
    const output = lines();
    for (const leaked of ['hunter2', 'k-123', 't-1', 'sig-abc']) {
      expect(output).not.toContain(leaked);
    }
    expect(output).toContain(REDACT_CENSOR);
  });

  it('removes order and session credentials wherever they appear in a log object', () => {
    const { logger, lines } = capture();
    logger.info({
      trackingToken: 'track-value',
      session: { sessionToken: 'session-value', csrfToken: 'csrf-value' },
      order: { idempotencyKey: 'idem-value', recoveryCodes: ['rc-1'] },
      req: { headers: { 'idempotency-key': 'header-idem-value' } },
    });
    for (const leaked of [
      'track-value',
      'session-value',
      'csrf-value',
      'idem-value',
      'rc-1',
      'header-idem-value',
    ]) {
      expect(lines()).not.toContain(leaked);
    }
  });

  it('removes authorization and cookie headers', () => {
    const { logger, lines } = capture();
    logger.info({ req: { headers: { authorization: 'Bearer abc', cookie: 'sid=xyz' } } });
    expect(lines()).not.toContain('Bearer abc');
    expect(lines()).not.toContain('sid=xyz');
  });
});
