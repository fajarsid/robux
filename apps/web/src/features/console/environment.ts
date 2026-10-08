import { headers } from 'next/headers';

export type ConsoleEnvironment = 'local' | 'production';

/**
 * Derived from the requested host so no extra configuration is needed: `*.localhost` and IP
 * literals are a developer machine, anything else is the public deployment.
 */
export async function consoleEnvironment(): Promise<ConsoleEnvironment> {
  const host = ((await headers()).get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  const local = host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host);
  return local ? 'local' : 'production';
}
