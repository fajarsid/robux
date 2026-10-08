'use client';

import type { CatalogProductView, CreateOrderRequest } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { QuantitySelector } from '@/components/forms/QuantitySelector';
import { Card } from '@/components/ui/Card';
import { usePriceQuote } from '@/features/pricing/hooks/usePriceQuote';
import { useCheckout } from '../hooks/useCheckout';
import { type CheckoutBuyer, CheckoutForm } from './CheckoutForm';
import { OrderConfirmation } from './OrderConfirmation';
import { OrderSummary } from './OrderSummary';
import { ProductSummary } from './ProductSummary';

interface CheckoutViewProps {
  product: CatalogProductView;
  initialQuantity: number;
  buyer: CheckoutBuyer;
}

/** Checkout page body: product, quantity, backend quote, recipient and order placement. */
export function CheckoutView({ product, initialQuantity, buyer }: CheckoutViewProps) {
  const t = useTranslations('checkout');
  const tProducts = useTranslations('products');
  const clamp = (value: number) =>
    Math.min(product.maxQuantity, Math.max(product.minQuantity, value));
  const [quantity, setQuantity] = useState(() => clamp(initialQuantity));
  const { quote, loading, errorCode: quoteError, refresh } = usePriceQuote(product.slug, quantity);
  const checkout = useCheckout();
  const shownQuote = loading ? null : quote;

  if (checkout.order) {
    return <OrderConfirmation order={checkout.order} />;
  }

  async function placeOrder(request: CreateOrderRequest) {
    const placed = await checkout.placeOrder(request);
    if (!placed) {
      // A changed price or product state means the quote on screen is no longer valid.
      refresh();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <ProductSummary product={product} totalRobux={shownQuote?.totalRobux ?? null} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{tProducts('quantity')}</span>
          <QuantitySelector
            value={quantity}
            min={product.minQuantity}
            max={product.maxQuantity}
            onChange={(value) => {
              checkout.clearError();
              setQuantity(value);
            }}
            label={tProducts('quantity')}
            decreaseLabel={tProducts('decrease')}
            increaseLabel={tProducts('increase')}
            disabled={checkout.submitting}
          />
        </div>
        <CheckoutForm
          productId={product.id}
          recipientType={product.recipientType}
          quote={shownQuote}
          buyer={buyer}
          submitting={checkout.submitting}
          errorCode={checkout.errorCode}
          onSubmit={placeOrder}
        />
      </Card>
      <Card className="h-fit">
        <OrderSummary pricing={shownQuote} />
        <div className="mt-3">
          <ApiErrorAlert code={quoteError} />
        </div>
      </Card>
    </div>
  );
}
