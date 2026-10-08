'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/forms/TextField';
import { useApiAction } from '@/hooks/useApiAction';
import { authService } from '../services/auth.service';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { PasswordField } from '@/components/forms/PasswordField';

interface LoginFormProps {
  portal: 'customer' | 'staff';
  submitLabel: string;
  onSuccess: () => void;
}

/** Email + password step, shared by the customer login and the staff login. */
export function LoginForm({ portal, submitLabel, onSuccess }: LoginFormProps) {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useApiAction(
    portal === 'staff' ? authService.loginStaff : authService.loginCustomer,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((await login.run({ email, password })).ok) {
      onSuccess();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t('email')}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordField
        label={t('password')}
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ApiErrorAlert code={login.errorCode} />
      <Button type="submit" loading={login.state === 'loading'}>
        {submitLabel}
      </Button>
    </form>
  );
}
