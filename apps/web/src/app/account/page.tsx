import type { AccountProfileView, CustomerOrderSummaryView } from '@robux/shared';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { ChangePasswordForm } from '@/features/account/components/ChangePasswordForm';
import { OrderHistoryList } from '@/features/account/components/OrderHistoryList';
import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { formatDateTime } from '@/lib/format/format';
import { serverApiGet } from '@/lib/api/server-api';

export default async function AccountPage() {
  // The API decides access (customer orders permission); a refusal sends the visitor to login.
  const [profile, orders] = await Promise.all([
    serverApiGet<AccountProfileView>('/me'),
    serverApiGet<CustomerOrderSummaryView[]>('/me/orders'),
  ]);
  if (!profile || !orders) {
    redirect('/login');
  }
  const t = await getTranslations('account');
  const tAuth = await getTranslations('auth');

  return (
    <PageShell className="flex flex-col gap-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <LogoutButton />
      </div>
      <Card>
        <h2 className="text-lg font-semibold">{t('profile')}</h2>
        <p className="mt-2">{profile.name ?? profile.email}</p>
        <p className="text-sm text-muted-foreground">{profile.email}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('memberSince', { date: formatDateTime(profile.createdAt) })}
        </p>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">{t('orders')}</h2>
        <div className="mt-2">
          <OrderHistoryList orders={orders} />
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">{tAuth('changePassword.title')}</h2>
        <div className="mt-4 max-w-md">
          <ChangePasswordForm />
        </div>
      </Card>
    </PageShell>
  );
}
