import { loadQueueConfig } from './queue-config';

describe('loadQueueConfig', () => {
  it('defaults to the standard BullMQ prefix and a shutdown timeout below stop_grace_period', () => {
    expect(loadQueueConfig({})).toEqual({ prefix: 'bull', shutdownTimeoutMs: 25_000 });
  });

  it('rejects a prefix that could break Redis key layout', () => {
    expect(() => loadQueueConfig({ QUEUE_PREFIX: 'a:b' })).toThrow(/QUEUE_PREFIX/);
  });
});
