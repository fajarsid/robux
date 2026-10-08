'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { SelectField } from '@/components/forms/SelectField';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/forms/TextField';
import { useOrderListNavigation } from '../hooks/useOrderListNavigation';
import { hasActiveFilters } from '../order-list-query';
import {
  isOrderStatus,
  isPaymentStatus,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from '../types/admin-orders';

const CLEARED = {
  q: undefined,
  status: undefined,
  paymentStatus: undefined,
  createdFrom: undefined,
  createdTo: undefined,
};

/**
 * Edits stay local until applied, so typing a search does not fire a request per keystroke.
 * Mounted with a key per URL query, so back/forward resets the fields to the URL.
 */
export function OrderFilters() {
  const t = useTranslations('adminOrders');
  const tPayment = useTranslations('payment.status');
  const { query, pending, navigate } = useOrderListNavigation();
  const [q, setQ] = useState(query.q ?? '');
  const [status, setStatus] = useState<string>(query.status ?? '');
  const [paymentStatus, setPaymentStatus] = useState<string>(query.paymentStatus ?? '');
  const [createdFrom, setCreatedFrom] = useState(query.createdFrom ?? '');
  const [createdTo, setCreatedTo] = useState(query.createdTo ?? '');

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({
      q: q.trim() || undefined,
      status: isOrderStatus(status) ? status : undefined,
      paymentStatus: isPaymentStatus(paymentStatus) ? paymentStatus : undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
    });
  }

  const any = { value: '', label: t('filters.any') };
  return (
    <form
      onSubmit={apply}
      role="search"
      aria-label={t('filters.label')}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"
    >
      <TextField
        size="md"
        label={t('filters.search')}
        type="search"
        value={q}
        maxLength={254}
        placeholder={t('filters.searchPlaceholder')}
        onChange={(event) => setQ(event.target.value)}
        className="sm:col-span-2"
      />
      <SelectField
        size="md"
        label={t('filters.status')}
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        options={[any, ...ORDER_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))]}
      />
      <SelectField
        size="md"
        label={t('filters.paymentStatus')}
        value={paymentStatus}
        onChange={(event) => setPaymentStatus(event.target.value)}
        options={[any, ...PAYMENT_STATUSES.map((value) => ({ value, label: tPayment(value) }))]}
      />
      <TextField
        size="md"
        label={t('filters.createdFrom')}
        type="date"
        value={createdFrom}
        max={createdTo || undefined}
        onChange={(event) => setCreatedFrom(event.target.value)}
      />
      <TextField
        size="md"
        label={t('filters.createdTo')}
        type="date"
        value={createdTo}
        min={createdFrom || undefined}
        onChange={(event) => setCreatedTo(event.target.value)}
      />
      <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end xl:col-span-6">
        {hasActiveFilters(query) && (
          <Button
            type="button"
            size="md"
            variant="outline"
            onClick={() => navigate(CLEARED)}
            disabled={pending}
          >
            {t('filters.reset')}
          </Button>
        )}
        <Button type="submit" size="md" loading={pending}>
          {t('filters.apply')}
        </Button>
      </div>
    </form>
  );
}
