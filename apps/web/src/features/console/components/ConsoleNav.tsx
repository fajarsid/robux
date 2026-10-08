'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { CONSOLE_NAVIGATION, isActiveNavItem } from '../navigation';

/**
 * Section navigation shared by the desktop sidebar and the mobile drawer. The active item is shown
 * by background, a filled icon and text weight; no border is used as the indicator.
 */
export function ConsoleNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('console');
  const pathname = usePathname();
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-6 px-3 py-4">
      {CONSOLE_NAVIGATION.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
            {t(`navSections.${section.label}`)}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActiveNavItem(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-panel px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-muted font-semibold text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      size="md"
                      variant={active ? 'bold' : 'linear'}
                      className={active ? 'text-primary' : ''}
                    />
                    {t(`nav.${item.label}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
