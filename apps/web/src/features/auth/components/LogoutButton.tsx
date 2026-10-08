'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import type { ButtonSize, ButtonVariant } from '@/components/ui/button-styles';
import { useApiAction } from '@/hooks/useApiAction';
import { authService } from '../services/auth.service';

export function LogoutButton({
  redirectTo = '/',
  variant = 'outline',
  size,
  className,
}: {
  redirectTo?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const t = useTranslations('auth');
  const router = useRouter();
  const logout = useApiAction(authService.logout);

  async function handleLogout() {
    await logout.run();
    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleLogout}
      loading={logout.state === 'loading'}
    >
      {t('logout')}
    </Button>
  );
}
