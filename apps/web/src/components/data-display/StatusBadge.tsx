import type { ReactNode } from 'react';

/**
 * The status vocabulary shared by every feature: `success` done, `progress` money taken and work in
 * flight, `attention` needs a customer or staff action, `danger` failed, `info` informational,
 * `neutral` closed or idle.
 */
export type StatusTone = 'success' | 'progress' | 'attention' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string }> = {
  success: { badge: 'border-success/40 text-success', dot: 'bg-success' },
  progress: { badge: 'border-primary-border text-primary', dot: 'bg-primary' },
  attention: { badge: 'border-warning/40 text-warning', dot: 'bg-warning' },
  danger: { badge: 'border-danger/40 text-danger', dot: 'bg-danger' },
  info: { badge: 'border-info/40 text-info', dot: 'bg-info' },
  neutral: { badge: 'border-border text-muted-foreground', dot: 'bg-muted-foreground' },
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const classes = TONE_CLASSES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes.badge}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${classes.dot}`} />
      {children}
    </span>
  );
}
