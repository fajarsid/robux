import type { ComponentProps } from 'react';
import { type ButtonSize, ICON_BUTTON_SIZES, VARIANT_CLASSES } from './button-styles';
import { Icon, type IconName } from './Icon';

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconName;
  /** Required: an icon-only control needs an accessible name. */
  label: string;
  variant?: 'ghost' | 'outline' | 'secondary' | 'danger';
  size?: ButtonSize;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-grid shrink-0 place-items-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ICON_BUTTON_SIZES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
    </button>
  );
}
