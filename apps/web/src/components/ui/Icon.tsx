import {
  Add,
  Archive,
  ArrowDown2,
  ArrowLeft2,
  ArrowRight2,
  ArrowSwapVertical,
  Box,
  Calendar,
  CloseCircle,
  CloseSquare,
  Copy,
  Danger,
  DocumentText,
  Edit2,
  Element3,
  Eye,
  EyeSlash,
  Filter,
  HambergerMenu,
  InfoCircle,
  LogoutCurve,
  Monitor,
  Moon,
  More,
  Refresh,
  SearchNormal1,
  ShieldTick,
  ShoppingCart,
  Sun1,
  Tag2,
  TickCircle,
  Trash,
  Warning2,
  type Icon as IconsaxIcon,
} from 'iconsax-react';

/**
 * The only place that imports Iconsax (ENGINEERING_STANDARDS.md §4.4). Names are what the icon means
 * in this product, so a feature never depends on Iconsax's naming and a swap stays local.
 */
const ICONS = {
  dashboard: Element3,
  orders: ShoppingCart,
  products: Box,
  pricing: Tag2,
  inventory: Archive,
  adjust: ArrowSwapVertical,
  security: ShieldTick,
  menu: HambergerMenu,
  close: CloseSquare,
  chevronLeft: ArrowLeft2,
  chevronRight: ArrowRight2,
  chevronDown: ArrowDown2,
  add: Add,
  edit: Edit2,
  delete: Trash,
  refresh: Refresh,
  copy: Copy,
  more: More,
  search: SearchNormal1,
  filter: Filter,
  calendar: Calendar,
  document: DocumentText,
  themeLight: Sun1,
  themeDark: Moon,
  themeSystem: Monitor,
  logout: LogoutCurve,
  show: Eye,
  hide: EyeSlash,
  success: TickCircle,
  error: CloseCircle,
  warning: Warning2,
  danger: Danger,
  info: InfoCircle,
} satisfies Record<string, IconsaxIcon>;

export type IconName = keyof typeof ICONS;

const SIZES = { xs: 14, sm: 16, md: 20, lg: 24 } as const;

/**
 * Decorative by default (hidden from assistive technology); pass `label` when the icon alone
 * carries meaning. `bold` is used for the active navigation item only.
 */
export function Icon({
  name,
  size = 'sm',
  variant = 'linear',
  label,
  className = '',
}: {
  name: IconName;
  size?: keyof typeof SIZES;
  variant?: 'linear' | 'bold' | 'bulk';
  label?: string;
  className?: string;
}) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={SIZES[size]}
      color="currentColor"
      variant={variant === 'linear' ? 'Linear' : variant === 'bold' ? 'Bold' : 'Bulk'}
      className={`shrink-0 ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
