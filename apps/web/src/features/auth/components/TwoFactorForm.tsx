'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/forms/TextField';
import { useApiAction } from '@/hooks/useApiAction';
import { authService } from '../services/auth.service';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';

/** Verifies a staff session with a TOTP code or, as a fallback, a single-use recovery code. */
export function TwoFactorForm({ onVerified }: { onVerified: () => void }) {
  const t = useTranslations('admin.twoFactor');
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const verify = useApiAction((input: string) =>
    useRecovery ? authService.useRecoveryCode(input) : authService.verifyTwoFactor(input),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((await verify.run(value.trim())).ok) {
      onVerified();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {useRecovery ? (
        <TextField
          label={t('recoveryCode')}
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : (
        <TextField
          label={t('code')}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        />
      )}
      <ApiErrorAlert code={verify.errorCode} />
      <Button type="submit" loading={verify.state === 'loading'}>
        {t('submit')}
      </Button>
      <Button
        type="button"
        variant="link"
        onClick={() => {
          setUseRecovery((v) => !v);
          setValue('');
        }}
      >
        {useRecovery ? t('useTotp') : t('useRecovery')}
      </Button>
    </form>
  );
}
