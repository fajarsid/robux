import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StaffLoginFlow } from '@/features/auth/components/StaffLoginFlow';
import { ConsoleBrand } from '@/features/console/components/ConsoleBrand';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { serverSession } from '@/lib/api/server-api';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.login');
  return { title: t('title') };
}

export default async function ConsoleLoginPage() {
  const session = await serverSession();
  const staffStep =
    session.authenticated && session.user.role !== 'CUSTOMER' ? session.twoFactor : undefined;
  if (staffStep === 'VERIFIED' || staffStep === 'NOT_ENROLLED') {
    redirect(CONSOLE_ROUTES.home);
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="-ml-6 mb-2">
          <ConsoleBrand />
        </div>
        <StaffLoginFlow initialStep={staffStep === 'PENDING' ? 'PENDING' : 'password'} />
      </div>
    </main>
  );
}
