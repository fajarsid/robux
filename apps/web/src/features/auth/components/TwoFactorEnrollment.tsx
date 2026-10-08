'use client';

import type { TwoFactorEnrollmentView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/forms/TextField';
import { useApiAction } from '@/hooks/useApiAction';
import { authService } from '../services/auth.service';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';

/**
 * Turns on optional staff 2FA: create a TOTP secret, confirm it with a code, then show the
 * recovery codes exactly once. The secret is shown for manual entry; no QR rendering yet.
 */
export function TwoFactorEnrollment({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations('admin.twoFactor');
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollmentView | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const begin = useApiAction(authService.beginTwoFactorEnrollment);
  const activate = useApiAction(authService.activateTwoFactor);

  async function start() {
    const result = await begin.run();
    if (result.ok) {
      setEnrollment(result.value);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    const result = await activate.run(code);
    if (result.ok) {
      setRecoveryCodes(result.value.recoveryCodes);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('recoveryTitle')}</h2>
        <Alert>{t('recoveryBody')}</Alert>
        <ol className="grid grid-cols-2 gap-2 font-mono text-sm sm:max-w-md">
          {recoveryCodes.map((recoveryCode) => (
            <li
              key={recoveryCode}
              className="rounded-control border border-border bg-surface-muted px-3 py-2 text-center"
            >
              {recoveryCode}
            </li>
          ))}
        </ol>
        <Button size="md" className="self-start" onClick={onComplete}>
          {t('recoveryDone')}
        </Button>
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('enrollSubtitle')}</p>
        <ApiErrorAlert code={begin.errorCode} />
        <Button
          size="md"
          className="self-start"
          onClick={start}
          loading={begin.state === 'loading'}
        >
          {t('start')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
      <div>
        <p className="text-sm font-medium">{t('secretLabel')}</p>
        <p className="mt-1 break-all rounded-control border border-border bg-surface-muted px-3 py-2 font-mono text-sm">
          {enrollment.secret}
        </p>
        <a
          href={enrollment.otpauthUri}
          className="mt-2 inline-block text-sm text-primary hover:text-primary-hover"
        >
          {t('openApp')}
        </a>
      </div>
      <TextField
        size="md"
        label={t('code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <ApiErrorAlert code={activate.errorCode} />
      <Button type="submit" size="md" className="self-start" loading={activate.state === 'loading'}>
        {t('activate')}
      </Button>
    </form>
  );
}
