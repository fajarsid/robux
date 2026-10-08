import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { FEEDBACK_TONES, type FeedbackTone } from './feedback-tone';

const TINT: Record<FeedbackTone, string> = {
  success: 'bg-success/10',
  error: 'bg-danger/10',
  warning: 'bg-warning/10',
  info: 'bg-surface-muted',
};

/** Inline message next to the content it is about. Errors are announced as alerts. */
export function Alert({ tone = 'info', children }: { tone?: FeedbackTone; children: ReactNode }) {
  const style = FEEDBACK_TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-panel border px-4 py-3 text-sm text-foreground ${style.border} ${TINT[tone]}`}
    >
      <Icon name={style.icon} className={`mt-0.5 ${style.iconClass}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
