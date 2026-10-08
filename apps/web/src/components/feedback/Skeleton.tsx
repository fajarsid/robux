import type { ReactNode } from 'react';

/** Loading placeholder block; size and shape come from `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`animate-pulse rounded-panel bg-surface-muted ${className}`} />
  );
}

/** Announces a loading region once to screen readers while skeletons are shown. */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      {children}
    </div>
  );
}
