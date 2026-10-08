import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

describe('legacy /admin URLs', () => {
  it('redirect permanently to the same page under /console', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: '/admin', destination: '/console', permanent: true },
        { source: '/admin/:path*', destination: '/console/:path*', permanent: true },
      ]),
    );
    // Only page URLs move; nothing touches the API namespace.
    expect(redirects.some((rule) => rule.source.startsWith('/api'))).toBe(false);
  });
});
