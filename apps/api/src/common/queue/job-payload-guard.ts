import type { JobDefinition, JobPayload } from './job-definition';
import { NonRetryableJobError } from './retry-policy';

/** Key names that indicate a credential or token (SECURITY.md: no secrets in job payloads). */
const FORBIDDEN_KEY =
  /password|passphrase|secret|token|cookie|credential|api_?key|signature|totp|recovery|authorization/i;

/**
 * Validates a payload against its job schema and the "identifiers only" rule. Runs on publish (a
 * bug fails loudly at the producer) and on consume (a corrupt record fails without retries).
 */
export function parseJobPayload<P extends JobPayload>(job: JobDefinition<P>, raw: unknown): P {
  const parsed = job.payload.safeParse(raw);
  if (!parsed.success) {
    throw new NonRetryableJobError(`Invalid payload for job ${job.name}`);
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new NonRetryableJobError(`Job ${job.name} payload key "${key}" is not allowed`);
    }
    if (value !== null && typeof value === 'object') {
      throw new NonRetryableJobError(`Job ${job.name} payload must be flat`);
    }
  }
  return parsed.data;
}
