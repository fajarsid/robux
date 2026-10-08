'use client';

import type { AdminSourceView, UpdateSourceRequest } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { TextField } from '@/components/forms/TextField';

export interface SourceFieldValues {
  name: string;
  priority: string;
  lowBalanceThreshold: string;
  costPerUnit: string;
}

export const EMPTY_SOURCE_FIELDS: SourceFieldValues = {
  name: '',
  priority: '100',
  lowBalanceThreshold: '0',
  costPerUnit: '',
};

export function sourceFieldValuesOf(source: AdminSourceView): SourceFieldValues {
  return {
    name: source.name,
    priority: String(source.priority),
    lowBalanceThreshold: source.lowBalanceThreshold,
    costPerUnit: source.costPerUnit ?? '',
  };
}

const digits = (value: string) => value.replace(/[^\d]/g, '');
const decimal = (value: string) => value.replace(/[^\d.]/g, '');

/** Source attributes shared by the create and edit dialogs. */
export function SourceFields({
  values,
  onChange,
}: {
  values: SourceFieldValues;
  onChange: (values: SourceFieldValues) => void;
}) {
  const t = useTranslations('adminInventory.fields');
  const set = (field: keyof SourceFieldValues) => (value: string) =>
    onChange({ ...values, [field]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        size="md"
        label={t('name')}
        required
        value={values.name}
        onChange={(e) => set('name')(e.target.value)}
      />
      <TextField
        size="md"
        label={t('priority')}
        hint={t('priorityHint')}
        inputMode="numeric"
        required
        value={values.priority}
        onChange={(e) => set('priority')(digits(e.target.value))}
      />
      <TextField
        size="md"
        label={t('lowBalanceThreshold')}
        inputMode="numeric"
        required
        value={values.lowBalanceThreshold}
        onChange={(e) => set('lowBalanceThreshold')(digits(e.target.value))}
      />
      <TextField
        size="md"
        label={t('costPerUnit')}
        hint={t('costPerUnitHint')}
        inputMode="decimal"
        value={values.costPerUnit}
        onChange={(e) => set('costPerUnit')(decimal(e.target.value))}
      />
    </div>
  );
}

export function toSourcePayload(values: SourceFieldValues): UpdateSourceRequest {
  return {
    name: values.name.trim(),
    priority: Number(values.priority || 0),
    lowBalanceThreshold: values.lowBalanceThreshold || '0',
    costPerUnit: values.costPerUnit.trim() === '' ? null : values.costPerUnit.trim(),
  };
}
