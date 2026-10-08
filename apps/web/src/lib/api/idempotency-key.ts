interface StoredAttempt {
  request: string;
  key: string;
}

/** 128 random bits as hex; getRandomValues also works outside secure contexts, unlike randomUUID. */
function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storageKey(scope: string): string {
  return `${scope}.idempotency`;
}

function readAttempt(scope: string): StoredAttempt | null {
  try {
    const raw = sessionStorage.getItem(storageKey(scope));
    return raw ? (JSON.parse(raw) as StoredAttempt) : null;
  } catch {
    return null;
  }
}

function writeAttempt(scope: string, attempt: StoredAttempt | null): void {
  try {
    if (attempt) {
      sessionStorage.setItem(storageKey(scope), JSON.stringify(attempt));
    } else {
      sessionStorage.removeItem(storageKey(scope));
    }
  } catch {
    // Storage may be unavailable (private mode); the in-memory key still covers double clicks.
  }
}

/**
 * The same request always reuses the same Idempotency-Key, also across a reload or a network
 * failure, so a retry can never create a second record. A changed request gets a new key. The
 * fingerprint is stored in sessionStorage, so it must never contain a secret or a tracking token.
 */
export function idempotencyKeyFor(scope: string, fingerprint: string): string {
  const stored = readAttempt(scope);
  if (stored?.request === fingerprint) {
    return stored.key;
  }
  const attempt = { request: fingerprint, key: newKey() };
  writeAttempt(scope, attempt);
  return attempt.key;
}

/** Called once the API has answered successfully: the next request is a new one. */
export function releaseIdempotencyKey(scope: string): void {
  writeAttempt(scope, null);
}
