/**
 * BullMQ waits for a ready connection before every command and reconnects forever, so a producer
 * call against an unreachable Redis (or one rejecting our password) never settles on its own.
 * Producers bound each call; the abandoned call may still complete after Redis returns, which is
 * harmless because job ids and scheduler ids are idempotent.
 */
export const QUEUE_COMMAND_TIMEOUT_MS = 5_000;

export async function withQueueTimeout<T>(
  operation: Promise<T>,
  description: string,
  timeoutMs = QUEUE_COMMAND_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Queue operation timed out after ${timeoutMs} ms: ${description}`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
