export interface SourceToProbe {
  id: string;
  provider: string;
}

/** Health of sources outside order traffic: the recovery path for sources taken out of routing. */
export interface SourceHealthRepository {
  /** ACTIVE sources that routing skips because their health is UNAVAILABLE or UNKNOWN. */
  sourcesToProbe(): Promise<SourceToProbe[]>;
  recordProbe(sourceId: string, healthy: boolean, now: Date): Promise<void>;
}

export const SOURCE_HEALTH_REPOSITORY = Symbol('SOURCE_HEALTH_REPOSITORY');
