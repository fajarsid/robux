'use client';

import { PASSWORD_MIN_LENGTH } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { useApiAction } from '@/hooks/useApiAction';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { PasswordField } from '@/components/forms/PasswordField';
import { authService } from '@/features/auth/services/auth.service';

export function ChangePasswordForm() {
  const t = useTranslations('auth');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const change = useApiAction(authService.changePassword);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((await change.run({ currentPassword, newPassword })).ok) {
      setCurrentPassword('');
      setNewPassword('');
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <PasswordField
        label={t('changePassword.current')}
        autoComplete="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
      <PasswordField
        label={t('changePassword.new')}
        hint={t('passwordHint')}
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <ApiErrorAlert code={change.errorCode} />
      {change.state === 'success' && <Alert tone="success">{t('changePassword.success')}</Alert>}
      <Button type="submit" variant="outline" loading={change.state === 'loading'}>
        {t('changePassword.submit')}
      </Button>
    </form>
  );
}
