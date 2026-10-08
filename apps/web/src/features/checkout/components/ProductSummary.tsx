import type { CatalogProductView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/format/format';

/** What is being bought: package, delivery method and the Robux the customer receives. */
export function ProductSummary({
  product,
  totalRobux,
}: {
  product: CatalogProductView;
  totalRobux: number | null;
}) {
  const t = useTranslations('checkout');
  const tProducts = useTranslations('products');
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{t('product')}</p>
      <p className="text-xl font-semibold">{product.name}</p>
      <p className="text-sm text-primary">{tProducts(`method.${product.fulfillmentMethod}`)}</p>
      {totalRobux !== null && product.platform === 'ROBLOX' && (
        <p className="text-sm text-muted-foreground">
          {tProducts('totalRobux', { amount: formatNumber(totalRobux) })}
        </p>
      )}
    </div>
  );
}
