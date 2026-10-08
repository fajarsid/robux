'use client';

import { PASSWORD_MIN_LENGTH } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/forms/TextField';
import { useApiAction } from '@/hooks/useApiAction';
import { authService } from '../services/auth.service';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { PasswordField } from '@/components/forms/PasswordField';

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const register = useApiAction(authService.register);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await register.run({
      email,
      password,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (result.ok) {
      onSuccess();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t('name')}
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
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
        hint={t('passwordHint')}
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ApiErrorAlert code={register.errorCode} />
      <Button type="submit" loading={register.state === 'loading'}>
        {t('register.submit')}
      </Button>
    </form>
  );
}
