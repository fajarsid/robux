'use client';

import type { CatalogProductView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { QuantitySelector } from '@/components/forms/QuantitySelector';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { formatNumber } from '@/lib/format/format';
import { PriceDisplay } from '@/features/pricing/components/PriceDisplay';
import { usePriceQuote } from '@/features/pricing/hooks/usePriceQuote';
import { checkoutHref } from '@/features/checkout/checkout-link';

/** Quantity choice and the backend-quoted total, leading to checkout. */
export function ProductPurchasePanel({ product }: { product: CatalogProductView }) {
  const t = useTranslations('products');
  const [quantity, setQuantity] = useState(product.minQuantity);
  const { quote, loading, errorCode } = usePriceQuote(product.slug, quantity);
  const outOfStock = product.availability !== 'AVAILABLE';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{t('quantity')}</span>
        <QuantitySelector
          value={quantity}
          min={product.minQuantity}
          max={product.maxQuantity}
          onChange={setQuantity}
          label={t('quantity')}
          decreaseLabel={t('decrease')}
          increaseLabel={t('increase')}
          disabled={outOfStock}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3" aria-live="polite">
        <span className="text-sm text-muted-foreground">{t('total')}</span>
        {loading || !quote ? (
          <span className="text-sm text-muted-foreground">{t('calculating')}</span>
        ) : (
          <PriceDisplay amount={quote.total} currency={quote.currency} size="lg" />
        )}
      </div>
      {quote && !loading && product.platform === 'ROBLOX' && (
        <p className="text-right text-xs text-muted-foreground">
          {t('totalRobux', { amount: formatNumber(quote.totalRobux) })}
        </p>
      )}
      <ApiErrorAlert code={errorCode} />
      {outOfStock ? (
        <Button disabled>{t('buy')}</Button>
      ) : (
        <ButtonLink href={checkoutHref(product.slug, quantity)}>{t('buy')}</ButtonLink>
      )}
    </div>
  );
}
