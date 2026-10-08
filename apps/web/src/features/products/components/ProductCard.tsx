import type { CatalogProductView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { formatNumber } from '@/lib/format/format';
import { PriceDisplay } from '@/features/pricing/components/PriceDisplay';
import { ProductPurchasePanel } from './ProductPurchasePanel';
import { ProductStatusBadge } from './ProductStatusBadge';

export function ProductCard({ product }: { product: CatalogProductView }) {
  const t = useTranslations('products');
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            {product.platform === 'ROBLOX'
              ? t('robux', { amount: formatNumber(product.robuxAmount) })
              : product.name}
          </p>
          <p className="mt-1 text-sm text-primary">
            {product.platform === 'ROBLOX'
              ? t(`method.${product.fulfillmentMethod}`)
              : `${t(`platform.${product.platform}`)} · ${t(`fulfillmentType.${product.fulfillmentType}`)}`}
          </p>
        </div>
        <ProductStatusBadge availability={product.availability} />
      </div>
      <div>
        <PriceDisplay amount={product.price.amount} currency={product.price.currency} size="lg" />
        <span className="ml-2 text-sm text-muted-foreground">{t('perUnit')}</span>
      </div>
      <ProductPurchasePanel product={product} />
    </Card>
  );
}
