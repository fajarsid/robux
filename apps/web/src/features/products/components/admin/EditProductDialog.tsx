'use client';

import type { AdminProductView } from '@robux/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { FormDialog } from '@/components/ui/FormDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { productsService } from '../../services/products.service';
import {
  fieldValuesOf,
  type ProductFieldValues,
  ProductFields,
  toProductPayload,
} from './ProductFields';

/**
 * Edit dialog with the same fields as creation. Mounted only while open, so it always starts from
 * the product as the page currently shows it.
 */
export function EditProductDialog({
  product,
  onClose,
}: {
  product: AdminProductView;
  onClose: () => void;
}) {
  const t = useTranslations('adminProducts');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const [fields, setFields] = useState<ProductFieldValues>(() => fieldValuesOf(product));
  const update = useApiAction(productsService.update);

  async function submit() {
    const payload = toProductPayload(fields);
    // Locked identity fields are not sent at all once the product has orders.
    const changes = product.hasOrders
      ? {
          name: payload.name,
          minQuantity: payload.minQuantity,
          maxQuantity: payload.maxQuantity,
          displayOrder: payload.displayOrder,
        }
      : payload;
    if ((await update.run(product.id, changes)).ok) {
      onClose();
      toast({ tone: 'success', title: t('saved'), description: payload.name });
      router.refresh();
    }
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('editTitle')}
      description={product.slug}
      submitLabel={t('save')}
      cancelLabel={tCommon('cancel')}
      submitting={update.state === 'loading'}
      size="lg"
      onSubmit={submit}
    >
      <ProductFields values={fields} onChange={setFields} identityLocked={product.hasOrders} />
      {product.hasOrders && <p className="text-xs text-muted-foreground">{t('lockedHint')}</p>}
      <ApiErrorAlert code={update.errorCode} />
    </FormDialog>
  );
}
