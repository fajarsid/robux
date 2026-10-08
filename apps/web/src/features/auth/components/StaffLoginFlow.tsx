'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { authService } from '../services/auth.service';
import { AuthCard } from './AuthCard';
import { LoginForm } from './LoginForm';
import { TwoFactorForm } from './TwoFactorForm';

type Step = 'password' | 'PENDING';

/**
 * Password, then the TOTP step only for staff who enabled 2FA; the server decides which (the
 * session reports PENDING until the code is verified). Enrolling is done later in Security.
 */
export function StaffLoginFlow({ initialStep }: { initialStep: Step }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);

  const goToConsole = () => {
    router.replace(CONSOLE_ROUTES.home);
    router.refresh();
  };

  async function afterPassword() {
    const session = await authService.session();
    if (!session.authenticated) {
      return;
    }
    if (session.twoFactor === 'PENDING') {
      setStep('PENDING');
    } else {
      goToConsole();
    }
  }

  if (step === 'PENDING') {
    return (
      <AuthCard title={t('twoFactor.verifyTitle')} subtitle={t('twoFactor.verifySubtitle')}>
        <TwoFactorForm onVerified={goToConsole} />
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('login.title')} subtitle={t('login.subtitle')}>
      <LoginForm portal="staff" submitLabel={t('login.submit')} onSuccess={afterPassword} />
    </AuthCard>
  );
}
