import type { ComponentProps } from 'react';
import { type FieldMessages, type FieldSize, fieldControlClassName, FormField } from './FormField';

type TextFieldProps = Omit<ComponentProps<'input'>, 'size'> & FieldMessages & { size?: FieldSize };

/** Text, search, email, number-like, date and datetime inputs. */
export function TextField({
  label,
  hint,
  error,
  required,
  size,
  className = '',
  id,
  ...props
}: TextFieldProps) {
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
        <input
          className={fieldControlClassName(size)}
          {...control}
          required={required}
          {...props}
        />
      )}
    </FormField>
  );
}
