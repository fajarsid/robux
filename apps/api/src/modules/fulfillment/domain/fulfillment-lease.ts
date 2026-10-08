/**
 * How long one run may hold an order's workflow. Longer than any provider call is allowed to take
 * (adapters time out well before), so a live run is never taken over; short enough that a crashed
 * run's order is picked up again within the job's retry schedule (5 s + 15 s + 30 s + 60 s + ...).
 */
export const FULFILLMENT_LEASE_MS = 90_000;
