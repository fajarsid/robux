import type { ComponentProps } from 'react';
import { type FieldMessages, type FieldSize, fieldControlClassName, FormField } from './FormField';

type SelectFieldProps = Omit<ComponentProps<'select'>, 'size'> &
  FieldMessages & {
    options: { value: string; label: string }[];
    size?: FieldSize;
  };

export function SelectField({
  label,
  hint,
  error,
  required,
  options,
  size,
  className = '',
  id,
  ...props
}: SelectFieldProps) {
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
        <select className={fieldControlClassName(size)} {...control} required={required} {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
