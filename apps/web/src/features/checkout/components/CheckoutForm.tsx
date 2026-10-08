'use client';

import type { CreateOrderRequest, PriceQuoteView, RecipientTypeName } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/forms/TextField';
import { CheckoutError } from './CheckoutError';

export type CheckoutBuyer =
  { kind: 'guest' } | { kind: 'customer'; email: string } | { kind: 'staff' };

interface CheckoutFormProps {
  productId: string;
  recipientType: RecipientTypeName | null;
  quote: PriceQuoteView | null;
  buyer: CheckoutBuyer;
  submitting: boolean;
  errorCode: string | null;
  onSubmit: (request: CreateOrderRequest) => void;
}

/**
 * Account identification and confirmation. The request names the product, the quantity and the
 * price version that was shown; it never carries an amount.
 */
export function CheckoutForm({
  productId,
  recipientType,
  quote,
  buyer,
  submitting,
  errorCode,
  onSubmit,
}: CheckoutFormProps) {
  const t = useTranslations('checkout');
  const [robloxUsername, setRobloxUsername] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  // Confirmation belongs to the amount shown: a new quote (e.g. after PRICE_CHANGED) needs a new tick.
  const [confirmedQuote, setConfirmedQuote] = useState<string | null>(null);
  const quoteKey = quote ? `${quote.priceVersionId}:${quote.quantity}:${quote.total}` : null;
  const confirmed = quoteKey !== null && confirmedQuote === quoteKey;
  const blocked = buyer.kind === 'staff';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!quote || blocked) {
      return;
    }
    onSubmit({
      productId,
      quantity: quote.quantity,
      priceVersionId: quote.priceVersionId,
      ...(recipientType === 'ROBLOX_USER'
        ? { recipient: { robloxUsername } }
        : recipientType === 'TELEGRAM_USER'
          ? { recipient: { telegramUsername } }
          : {}),
      ...(buyer.kind === 'guest' ? { contactEmail: contactEmail.trim() } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {recipientType === 'ROBLOX_USER' ? (
        <TextField
          label={t('robloxUsername')}
          hint={t('robloxUsernameHint')}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9]+(_[A-Za-z0-9]+)?"
          value={robloxUsername}
          // Roblox usernames never contain spaces; dropping them keeps the native pattern check usable.
          onChange={(e) => setRobloxUsername(e.target.value.replace(/\s/g, ''))}
          disabled={blocked}
        />
      ) : recipientType === 'TELEGRAM_USER' ? (
        <TextField
          label={t('telegramUsername')}
          hint={t('telegramUsernameHint')}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={5}
          maxLength={33}
          value={telegramUsername}
          onChange={(e) => setTelegramUsername(e.target.value.trim())}
          disabled={blocked}
        />
      ) : null}
      {buyer.kind === 'guest' ? (
        <TextField
          label={t('contactEmail')}
          hint={t('contactEmailHint')}
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
      ) : buyer.kind === 'customer' ? (
        <p className="text-sm text-muted-foreground">{t('signedInAs', { email: buyer.email })}</p>
      ) : null}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-primary"
          checked={confirmed}
          onChange={(e) => setConfirmedQuote(e.target.checked ? quoteKey : null)}
          required
          disabled={blocked || !quote}
        />
        <span>{t('confirmDetails')}</span>
      </label>
      <CheckoutError code={blocked ? 'STAFF_CANNOT_ORDER' : errorCode} />
      <Button type="submit" loading={submitting} disabled={!quote || !confirmed || blocked}>
        {t('placeOrder')}
      </Button>
    </form>
  );
}
