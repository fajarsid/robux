import { safeImageUrl } from '../payment-links';
import type { PaymentMethod } from '../types/payment.types';

interface PaymentMethodOptionProps {
  method: PaymentMethod;
  name: string;
  checked: boolean;
  disabled: boolean;
  unavailableLabel: string;
  onSelect: (id: string) => void;
}

/** One method as a native radio inside a card-sized label, so keyboard and screen readers work as usual. */
export function PaymentMethodOption({
  method,
  name,
  checked,
  disabled,
  unavailableLabel,
  onSelect,
}: PaymentMethodOptionProps) {
  const icon = safeImageUrl(method.icon);
  const inactive = disabled || !method.available;
  return (
    <label
      className={`flex min-h-14 items-center gap-3 rounded-control border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary-hover ${
        checked ? 'border-primary bg-surface-muted' : 'border-border'
      } ${inactive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-primary-border'}`}
    >
      <input
        type="radio"
        name={name}
        value={method.id}
        checked={checked}
        disabled={inactive}
        onChange={() => onSelect(method.id)}
        className="h-4 w-4 shrink-0 accent-primary"
      />
      {icon && (
        // Method logos come from the API; next/image would need every gateway host configured.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className="h-6 w-auto max-w-16 shrink-0 object-contain" />
      )}
      <span className="flex-1 font-medium">{method.name}</span>
      {!method.available && (
        <span className="text-xs text-muted-foreground">{unavailableLabel}</span>
      )}
    </label>
  );
}
