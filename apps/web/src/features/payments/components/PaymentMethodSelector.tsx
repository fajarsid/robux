'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { PaymentMethod } from '../types/payment.types';
import { PaymentMethodOption } from './PaymentMethodOption';

interface PaymentMethodSelectorProps {
  methods: PaymentMethod[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

/** Methods grouped by the category the API reports, in the order the API returned them. */
export function PaymentMethodSelector({
  methods,
  selectedId,
  disabled = false,
  onSelect,
}: PaymentMethodSelectorProps) {
  const t = useTranslations('payment.start');
  const name = useId();
  const groups = new Map<string, PaymentMethod[]>();
  for (const method of methods) {
    const category = method.category ?? '';
    groups.set(category, [...(groups.get(category) ?? []), method]);
  }

  return (
    <fieldset role="radiogroup" className="flex flex-col gap-4" disabled={disabled}>
      <legend className="mb-3 text-sm font-semibold">{t('methods')}</legend>
      {[...groups].map(([category, items]) => (
        <div key={category} className="flex flex-col gap-2">
          {category && (
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {category}
            </p>
          )}
          {items.map((method) => (
            <PaymentMethodOption
              key={method.id}
              method={method}
              name={name}
              checked={selectedId === method.id}
              disabled={disabled}
              unavailableLabel={t('methodUnavailable')}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </fieldset>
  );
}
