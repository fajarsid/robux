import type { IconName } from '@/components/ui/Icon';

/** One vocabulary for inline alerts and toasts: same icon and colour for the same meaning. */
export type FeedbackTone = 'success' | 'error' | 'warning' | 'info';

export const FEEDBACK_TONES: Record<
  FeedbackTone,
  { icon: IconName; border: string; iconClass: string }
> = {
  success: { icon: 'success', border: 'border-success/40', iconClass: 'text-success' },
  error: { icon: 'error', border: 'border-danger/40', iconClass: 'text-danger' },
  warning: { icon: 'warning', border: 'border-warning/40', iconClass: 'text-warning' },
  info: { icon: 'info', border: 'border-border', iconClass: 'text-info' },
};
