import { Heartbeat } from './heartbeat';

describe('Heartbeat', () => {
  it('is fresh right after start and stale after 30s without beats', () => {
    const hb = new Heartbeat();
    const start = Date.now();
    expect(hb.isFresh(start)).toBe(true);
    expect(hb.isFresh(start + 29_000)).toBe(true);
    expect(hb.isFresh(start + 31_000)).toBe(false);
  });
});
