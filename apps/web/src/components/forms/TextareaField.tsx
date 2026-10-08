import type { ComponentProps } from 'react';
import { type FieldMessages, fieldControlClassName, FormField } from './FormField';

type TextareaFieldProps = ComponentProps<'textarea'> & FieldMessages;

export function TextareaField({
  label,
  hint,
  error,
  required,
  className = '',
  id,
  rows = 3,
  ...props
}: TextareaFieldProps) {
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
        <textarea
          rows={rows}
          className={fieldControlClassName('md', 'h-auto py-2 leading-relaxed')}
          {...control}
          required={required}
          {...props}
        />
      )}
    </FormField>
  );
}
