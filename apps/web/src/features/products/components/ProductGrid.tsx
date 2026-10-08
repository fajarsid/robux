import type { CatalogProductView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { ProductCard } from './ProductCard';

export function ProductGrid({ products }: { products: CatalogProductView[] }) {
  const t = useTranslations('products');
  if (products.length === 0) {
    return <p className="text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
