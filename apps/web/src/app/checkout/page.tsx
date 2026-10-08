import type { CatalogProductView } from '@robux/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/layout/PageShell';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { parseCheckoutQuantity } from '@/features/checkout/checkout-link';
import type { CheckoutBuyer } from '@/features/checkout/components/CheckoutForm';
import { CheckoutView } from '@/features/checkout/components/CheckoutView';
import { serverApiGet, serverSession } from '@/lib/api/server-api';

// The confirmation shows the private tracking link: keep it out of Referer headers and indexes.
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; quantity?: string }>;
}) {
  const { product: slug, quantity } = await searchParams;
  const [product, session] = await Promise.all([
    slug ? serverApiGet<CatalogProductView>(`/products/${encodeURIComponent(slug)}`) : null,
    serverSession(),
  ]);

  if (!product || product.availability !== 'AVAILABLE') {
    const t = await getTranslations('checkout');
    return (
      <PageShell className="max-w-2xl py-16">
        <h1 className="text-2xl font-semibold">{t('unavailableTitle')}</h1>
        <p className="mt-3 text-muted-foreground">{t('unavailableBody')}</p>
        <ButtonLink href="/products" variant="outline" className="mt-6">
          {t('backToProducts')}
        </ButtonLink>
      </PageShell>
    );
  }

  const buyer: CheckoutBuyer = !session.authenticated
    ? { kind: 'guest' }
    : session.user.role === 'CUSTOMER'
      ? { kind: 'customer', email: session.user.email }
      : { kind: 'staff' };

  return (
    <PageShell className="py-10">
      <CheckoutView
        product={product}
        initialQuantity={parseCheckoutQuantity(quantity, product.minQuantity)}
        buyer={buyer}
      />
    </PageShell>
  );
}
