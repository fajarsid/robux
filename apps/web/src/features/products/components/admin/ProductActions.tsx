'use client';

import type { AdminProductView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { type DropdownItem, DropdownMenu } from '@/components/ui/DropdownMenu';
import { IconButton } from '@/components/ui/IconButton';
import { CONSOLE_ROUTES } from '@/features/console/routes';
import { NewPriceDialog } from '@/features/pricing/components/NewPriceDialog';
import { EditProductDialog } from './EditProductDialog';
import { ProductStatusDialog } from './ProductStatusDialog';

type OpenDialog = 'edit' | 'status' | 'price' | null;

function currencyOf(product: AdminProductView) {
  return product.currentPrice?.currency ?? 'IDR';
}

/** Mounts the dialog an action asked for; one at a time. */
function ProductDialogs({
  product,
  open,
  onClose,
}: {
  product: AdminProductView;
  open: OpenDialog;
  onClose: () => void;
}) {
  if (open === 'edit') {
    return <EditProductDialog product={product} onClose={onClose} />;
  }
  if (open === 'status') {
    return (
      <ProductStatusDialog
        productId={product.id}
        productName={product.name}
        isActive={product.isActive}
        onClose={onClose}
      />
    );
  }
  if (open === 'price') {
    return (
      <NewPriceDialog product={{ ...product, currency: currencyOf(product) }} onClose={onClose} />
    );
  }
  return null;
}

/** Row menu of the product table. Pricing actions are offered by the API's rules, not hidden here. */
export function ProductRowActions({
  product,
  include = ['view', 'edit', 'price', 'status'],
}: {
  product: AdminProductView;
  include?: ('view' | 'edit' | 'price' | 'status')[];
}) {
  const t = useTranslations('adminProducts');
  const tPricing = useTranslations('pricing');
  const [open, setOpen] = useState<OpenDialog>(null);
  const actions: Record<'view' | 'edit' | 'price' | 'status', DropdownItem> = {
    view: { label: t('view'), icon: 'document', href: CONSOLE_ROUTES.product(product.id) },
    edit: { label: t('edit'), icon: 'edit', onSelect: () => setOpen('edit') },
    price: { label: tPricing('newPriceTitle'), icon: 'pricing', onSelect: () => setOpen('price') },
    status: {
      label: product.isActive ? t('deactivate') : t('activate'),
      icon: product.isActive ? 'error' : 'success',
      tone: product.isActive ? 'danger' : 'default',
      onSelect: () => setOpen('status'),
    },
  };
  return (
    <>
      <DropdownMenu
        label={t('actionsFor', { name: product.name })}
        trigger={(props) => (
          <IconButton
            icon="more"
            label={t('actionsFor', { name: product.name })}
            size="sm"
            {...props}
          />
        )}
        items={include.map((key) => actions[key])}
      />
      <ProductDialogs product={product} open={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Primary actions in the product page header. */
export function ProductHeaderActions({ product }: { product: AdminProductView }) {
  const t = useTranslations('adminProducts');
  const tPricing = useTranslations('pricing');
  const [open, setOpen] = useState<OpenDialog>(null);
  return (
    <>
      <Button size="md" variant="outline" icon="edit" onClick={() => setOpen('edit')}>
        {t('edit')}
      </Button>
      <Button
        size="md"
        variant={product.isActive ? 'danger' : 'outline'}
        icon={product.isActive ? 'error' : 'success'}
        onClick={() => setOpen('status')}
      >
        {product.isActive ? t('deactivate') : t('activate')}
      </Button>
      <Button size="md" icon="add" onClick={() => setOpen('price')}>
        {tPricing('newPriceTitle')}
      </Button>
      <ProductDialogs product={product} open={open} onClose={() => setOpen(null)} />
    </>
  );
}
