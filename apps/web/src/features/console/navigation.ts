import type { IconName } from '@/components/ui/Icon';
import { CONSOLE_ROUTES } from './routes';

export interface ConsoleNavItem {
  href: string;
  /** Key under `console.nav`. */
  label: 'dashboard' | 'orders' | 'products' | 'pricing' | 'inventory' | 'security';
  icon: IconName;
  /** The dashboard is active only on its own URL; sections also on their sub-pages. */
  exact?: boolean;
}

export interface ConsoleNavSection {
  /** Key under `console.navSections`. */
  label: 'overview' | 'commerce' | 'system';
  items: ConsoleNavItem[];
}

/**
 * Only screens that exist are listed. Every staff role may open each of them; what a role may do
 * on a screen is decided by the API (products without costs for OPERATOR, cancel for ADMIN+).
 * Payments, fulfillment, customers, staff, notifications, audit and settings join the list in the
 * phases that build their backends.
 */
export const CONSOLE_NAVIGATION: readonly ConsoleNavSection[] = [
  {
    label: 'overview',
    items: [{ href: CONSOLE_ROUTES.home, label: 'dashboard', icon: 'dashboard', exact: true }],
  },
  {
    label: 'commerce',
    items: [
      { href: CONSOLE_ROUTES.orders, label: 'orders', icon: 'orders' },
      { href: CONSOLE_ROUTES.products, label: 'products', icon: 'products' },
      { href: CONSOLE_ROUTES.pricing, label: 'pricing', icon: 'pricing' },
      { href: CONSOLE_ROUTES.inventory, label: 'inventory', icon: 'inventory' },
    ],
  },
  {
    label: 'system',
    items: [{ href: CONSOLE_ROUTES.security, label: 'security', icon: 'security' }],
  },
];

export function isActiveNavItem(item: ConsoleNavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
