'use client';

import { useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { type FieldMessages, type FieldSize, fieldControlClassName, FormField } from './FormField';

type PasswordFieldProps = Omit<ComponentProps<'input'>, 'size' | 'type'> &
  FieldMessages & { size?: FieldSize };

/** Password input with a show/hide toggle; the value never leaves the field. */
export function PasswordField({
  label,
  hint,
  error,
  required,
  size,
  className = '',
  id,
  ...props
}: PasswordFieldProps) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      required={required}
      id={id}
      className={className}
    >
      {(control) => (
        <div className="relative">
          <input
            type={visible ? 'text' : 'password'}
            className={fieldControlClassName(size, 'pr-12')}
            {...control}
            required={required}
            {...props}
          />
          <IconButton
            icon={visible ? 'hide' : 'show'}
            label={visible ? t('hidePassword') : t('showPassword')}
            size="sm"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-2 my-auto"
          />
        </div>
      )}
    </FormField>
  );
}
