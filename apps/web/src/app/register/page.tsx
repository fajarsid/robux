import { redirect } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { CustomerLoginPanel } from '@/features/auth/components/CustomerLoginPanel';
import { serverSession } from '@/lib/api/server-api';

export default async function RegisterPage() {
  const session = await serverSession();
  if (session.authenticated && session.user.role === 'CUSTOMER') {
    redirect('/account');
  }
  return (
    <PageShell>
      <CustomerLoginPanel mode="register" />
    </PageShell>
  );
}
