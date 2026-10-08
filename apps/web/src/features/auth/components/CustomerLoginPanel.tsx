'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/feedback/Alert';
import { AuthCard } from './AuthCard';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

/** Customer sign-in or sign-up; both land on the account page. */
export function CustomerLoginPanel({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const goToAccount = () => {
    router.replace('/account');
    router.refresh();
  };

  return (
    <AuthCard title={t(`${mode}.title`)} subtitle={t(`${mode}.subtitle`)}>
      <div className="flex flex-col gap-6">
        <Alert>{t('notRoblox')}</Alert>
        {mode === 'login' ? (
          <LoginForm portal="customer" submitLabel={t('login.submit')} onSuccess={goToAccount} />
        ) : (
          <RegisterForm onSuccess={goToAccount} />
        )}
        <p className="text-sm text-muted-foreground">
          {mode === 'login' ? t('login.noAccount') : t('register.hasAccount')}{' '}
          <Link
            href={mode === 'login' ? '/register' : '/login'}
            className="text-primary hover:text-primary-hover"
          >
            {mode === 'login' ? t('login.registerLink') : t('register.loginLink')}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
