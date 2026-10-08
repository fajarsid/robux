/** Process-specific readiness check added to the PostgreSQL and Redis checks (e.g. queue consumers). */
export interface ReadinessProbe {
  readonly name: string;
  check(): Promise<void>;
}

export const READINESS_PROBES = Symbol('READINESS_PROBES');
