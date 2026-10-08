import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageContainer } from './PageContainer';

const NAV_LINK =
  'rounded-control px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground';

export async function SiteHeader() {
  const t = await getTranslations('nav');
  return (
    <header className="border-b border-border">
      <PageContainer className="flex h-16 items-center justify-between">
        <Link href="/" className="text-base font-semibold tracking-tight">
          <span className="text-primary" aria-hidden="true">
            ●
          </span>{' '}
          {t('brand')}
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/products" className={NAV_LINK}>
            {t('products')}
          </Link>
          <Link href="/order" className={NAV_LINK}>
            {t('checkOrder')}
          </Link>
          <Link href="/account" className={NAV_LINK}>
            {t('account')}
          </Link>
        </nav>
      </PageContainer>
    </header>
  );
}
