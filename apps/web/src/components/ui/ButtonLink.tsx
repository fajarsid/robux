import Link from 'next/link';
import type { ComponentProps } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-styles';
import { Icon, type IconName } from './Icon';

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
}

export function ButtonLink({
  variant = 'primary',
  size,
  icon,
  className = '',
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName(variant, className, size)} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}
