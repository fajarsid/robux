'use client';

interface QuantitySelectorProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  label: string;
  disabled?: boolean;
}

/**
 * Keeps the value inside [min, max] for a good experience. The backend validates the quantity
 * again and is the authority.
 */
export function QuantitySelector({
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  label,
  disabled = false,
}: QuantitySelectorProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.trunc(next)));
  const buttonClass =
    'h-10 w-10 rounded-control border border-border text-lg transition-colors hover:border-primary-border disabled:opacity-40';
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label={decreaseLabel}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        className="h-10 w-16 rounded-control border border-border bg-surface text-center"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onChange(clamp(parsed));
          }
        }}
      />
      <button
        type="button"
        className={buttonClass}
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label={increaseLabel}
      >
        +
      </button>
    </div>
  );
}
