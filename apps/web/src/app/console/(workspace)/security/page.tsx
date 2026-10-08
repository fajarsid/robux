import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { PageHeader } from '@/components/layout/PageHeader';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { TwoFactorSettings } from '@/features/console/security/components/TwoFactorSettings';
import { serverSession } from '@/lib/api/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('console.security'))('title') };
}

export default async function ConsoleSecurityPage() {
  const [t, tConsole, session] = await Promise.all([
    getTranslations('console.security'),
    getTranslations('console'),
    serverSession(),
  ]);
  // The workspace layout already admitted only staff; PENDING never reaches this page.
  const enabled = session.authenticated && session.twoFactor === 'VERIFIED';
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        breadcrumb={
          <Breadcrumb
            label={tConsole('breadcrumb')}
            items={[
              { label: tConsole('nav.dashboard'), href: CONSOLE_ROUTES.home },
              { label: t('title') },
            ]}
          />
        }
      />
      <div className="max-w-3xl">
        <TwoFactorSettings enabled={enabled} />
      </div>
    </>
  );
}
