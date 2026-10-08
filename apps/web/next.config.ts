import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production container (infra/docker/web.Dockerfile).
  output: 'standalone',
  // Monorepo: trace workspace packages from the repository root.
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  // The staff UI moved from /admin to /console. Old bookmarks keep working; the API namespace
  // (/api/v1/admin, served by Nginx to the API, never to Next.js) is unaffected.
  async redirects() {
    return [
      { source: '/admin', destination: '/console', permanent: true },
      { source: '/admin/:path*', destination: '/console/:path*', permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
