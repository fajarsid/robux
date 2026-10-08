import { readFileSync } from 'node:fs';

/**
 * Reads a secret from the file named by `NAME_FILE` (Docker Compose `secrets:` mount),
 * falling back to `NAME`. One trailing newline is stripped.
 */
export function readSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const filePath = env[`${name}_FILE`];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new Error(`Secret file for ${name} could not be read (${name}_FILE is set)`);
    }
  }
  const value = env[name];
  return value === '' ? undefined : value;
}
