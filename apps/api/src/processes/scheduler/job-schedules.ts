import type { JobSchedule } from '../../common/queue/bullmq-job-schedule.registrar';
import {
  PAYMENT_EXPIRY_SWEEP_INTERVAL_MS,
  PAYMENT_EXPIRY_SWEEP_JOB,
} from '../jobs/payment-expiry-sweep.job';
import {
  SOURCE_HEALTH_CHECK_INTERVAL_MS,
  SOURCE_HEALTH_CHECK_JOB,
} from '../jobs/source-health-check.job';

/** Every repeating job in the system. Removing an entry removes its schedule on the next start. */
export const JOB_SCHEDULES: readonly JobSchedule[] = [
  { job: PAYMENT_EXPIRY_SWEEP_JOB, payload: {}, everyMs: PAYMENT_EXPIRY_SWEEP_INTERVAL_MS },
  { job: SOURCE_HEALTH_CHECK_JOB, payload: {}, everyMs: SOURCE_HEALTH_CHECK_INTERVAL_MS },
];
