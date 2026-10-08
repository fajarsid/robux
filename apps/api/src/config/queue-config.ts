import { z } from 'zod';

export interface QueueConfig {
  /** BullMQ key prefix. Environments are separated by their own Redis, not by prefix. */
  prefix: string;
  /** How long a worker waits for active jobs on shutdown; below Compose `stop_grace_period`. */
  shutdownTimeoutMs: number;
}

const queueEnvSchema = z.object({
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .default('bull'),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(25_000),
});

export function loadQueueConfig(env: NodeJS.ProcessEnv): QueueConfig {
  const parsed = queueEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return {
    prefix: parsed.data.QUEUE_PREFIX,
    shutdownTimeoutMs: parsed.data.WORKER_SHUTDOWN_TIMEOUT_MS,
  };
}
