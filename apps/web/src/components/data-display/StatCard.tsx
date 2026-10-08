import type { ReactNode } from 'react';

/**
 * One headline number. `value` null renders the unavailable state with its reason, so a metric
 * the backend cannot provide yet is never shown as zero.
 */
export function StatCard({
  label,
  value,
  hint,
  unavailableText,
}: {
  label: string;
  value: ReactNode | null;
  hint?: string;
  unavailableText: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-border bg-surface px-5 py-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      {value === null ? (
        <p className="text-sm text-muted-foreground">{unavailableText}</p>
      ) : (
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
