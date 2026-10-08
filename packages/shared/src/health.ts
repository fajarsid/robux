export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  service: string;
  checks: Record<string, DependencyStatus>;
}
