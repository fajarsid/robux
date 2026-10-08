'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TextField } from '@/components/forms/TextField';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { productsService } from '../../services/products.service';
import {
  EMPTY_PRODUCT_FIELDS,
  type ProductFieldValues,
  ProductFields,
  toProductPayload,
} from './ProductFields';

const digits = (value: string) => value.replace(/[^\d]/g, '');

/** "Produk baru" button and its dialog. The product is created inactive with price version 1. */
export function CreateProductDialog() {
  const t = useTranslations('adminProducts');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [fields, setFields] = useState<ProductFieldValues>(EMPTY_PRODUCT_FIELDS);
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [starsAmount, setStarsAmount] = useState('');
  const create = useApiAction(productsService.create);

  function reset() {
    setSlug('');
    setFields(EMPTY_PRODUCT_FIELDS);
    setSellingPrice('');
    setCostPrice('');
    setStarsAmount('');
  }

  async function submit() {
    const result = await create.run({
      slug: slug.trim(),
      ...toProductPayload(fields),
      initialPrice: { sellingPrice, costPrice, ...(starsAmount ? { starsAmount: Number(starsAmount) } : {}) },
    });
    if (result.ok) {
      setOpen(false);
      reset();
      toast({ tone: 'success', title: t('created'), description: result.value.name });
      router.refresh();
    }
  }

  return (
    <>
      <Button size="md" icon="add" onClick={() => setOpen(true)}>
        {t('newProduct')}
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('createTitle')}
        description={t('createHint')}
        submitLabel={t('create')}
        cancelLabel={tCommon('cancel')}
        submitting={create.state === 'loading'}
        size="lg"
        onSubmit={submit}
      >
        <TextField
          size="md"
          label={t('fields.slug')}
          hint={t('fields.slugHint')}
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        <ProductFields values={fields} onChange={setFields} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            size="md"
            label={t('fields.sellingPrice')}
            inputMode="numeric"
            required
            value={sellingPrice}
            onChange={(e) => setSellingPrice(digits(e.target.value))}
          />
          <TextField
            size="md"
            label={t('fields.costPrice')}
            inputMode="numeric"
            required
            value={costPrice}
            onChange={(e) => setCostPrice(digits(e.target.value))}
          />
        </div>
        <TextField
          size="md"
          label={t('fields.starsAmount')}
          hint={t('fields.starsAmountHint')}
          inputMode="numeric"
          value={starsAmount}
          onChange={(e) => setStarsAmount(digits(e.target.value))}
        />
        <ApiErrorAlert code={create.errorCode} />
      </FormDialog>
    </>
  );
}
