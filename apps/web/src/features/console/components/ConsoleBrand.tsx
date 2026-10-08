import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CONSOLE_ROUTES } from '../routes';

export function ConsoleBrand() {
  const t = useTranslations('console');
  return (
    <Link href={CONSOLE_ROUTES.home} className="flex items-center gap-2.5 px-6 py-5">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-panel bg-primary text-xs font-bold text-primary-foreground"
      >
        R
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">{t('brand')}</span>
        <span className="text-2xs text-muted-foreground">{t('brandSubtitle')}</span>
      </span>
    </Link>
  );
}
