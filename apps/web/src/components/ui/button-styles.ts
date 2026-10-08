export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** `lg` is the storefront size; the staff console uses the denser `md` and `sm`. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-panel px-3 text-sm',
  md: 'h-10 rounded-panel px-4 text-sm',
  lg: 'h-12 rounded-control px-6',
};

/** Square sizes for icon-only buttons, matching the text sizes' heights. */
export const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-8 rounded-panel',
  md: 'size-10 rounded-panel',
  lg: 'size-12 rounded-control',
};

export const VARIANT_CLASSES: Record<Exclude<ButtonVariant, 'link'>, string> = {
  primary: 'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover',
  secondary: 'bg-muted font-medium text-foreground hover:bg-muted/70',
  outline: 'border border-border font-medium text-foreground hover:border-primary-border',
  ghost: 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'border border-danger/50 font-medium text-danger hover:bg-danger/10',
};

/** Shared by Button, ButtonLink and IconButton so a variant looks the same everywhere. */
export function buttonClassName(
  variant: ButtonVariant,
  extra = '',
  size: ButtonSize = 'lg',
): string {
  if (variant === 'link') {
    return `${BASE} font-medium text-primary hover:text-primary-hover ${extra}`.trim();
  }
  const glow = variant === 'primary' && size === 'lg' ? 'shadow-glow' : '';
  return `${BASE} ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${glow} ${extra}`.trim();
}
