import { type ReactNode, useId } from 'react';

export type FieldSize = 'md' | 'lg';

const CONTROL_SIZES: Record<FieldSize, string> = {
  md: 'h-10 rounded-panel px-3 text-sm',
  lg: 'h-12 rounded-control px-4',
};

/** One look for every input, select and textarea: border, focus, invalid and disabled states. */
export function fieldControlClassName(size: FieldSize = 'lg', extra = ''): string {
  return `w-full border border-border bg-surface text-foreground placeholder:text-muted-foreground focus:border-primary-border focus:outline-none aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60 ${CONTROL_SIZES[size]} ${extra}`.trim();
}

export interface FieldMessages {
  label: string;
  hint?: string;
  /** Shown instead of the hint and marks the control invalid. */
  error?: string;
  /** Shows the required marker; the control itself must also receive `required`. */
  required?: boolean;
}

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/**
 * Label, control and helper text with the accessibility wiring done once. `children` receives the
 * id and aria attributes for the control it renders.
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  id,
  className = '',
  children,
}: FieldMessages & {
  id?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const message = error ?? hint;
  const messageId = message ? `${controlId}-message` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline gap-0.5">
        <label htmlFor={controlId} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {/* The control's `required` attribute is what assistive technology announces. */}
        {required && (
          <span aria-hidden className="text-sm text-danger">
            *
          </span>
        )}
      </div>
      {children({
        id: controlId,
        'aria-describedby': messageId,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {message && (
        <p id={messageId} className={`text-xs ${error ? 'text-danger' : 'text-muted-foreground'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
