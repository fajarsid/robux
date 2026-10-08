import type { ComponentProps } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-styles';
import { Icon, type IconName } from './Icon';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon; the text stays the accessible name. */
  icon?: IconName;
}

/** Defaults to `type="button"`; form submits must say `type="submit"`. */
export function Button({
  variant = 'primary',
  size,
  loading = false,
  icon,
  disabled,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, className, size)}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {icon && <Icon name={icon} className={loading ? 'animate-pulse' : ''} />}
      {children}
    </button>
  );
}
