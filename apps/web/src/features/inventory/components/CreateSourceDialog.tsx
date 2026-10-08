'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PRODUCT_LINES, type ProductLineName } from '@robux/shared';
import { SelectField } from '@/components/forms/SelectField';
import { TextField } from '@/components/forms/TextField';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { inventoryService } from '../services/inventory.service';
import {
  EMPTY_SOURCE_FIELDS,
  SourceFields,
  type SourceFieldValues,
  toSourcePayload,
} from './SourceFields';

/** "Sumber baru" button and its dialog. The source is created inactive (kill switch on). */
export function CreateSourceDialog() {
  const t = useTranslations('adminInventory');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const tProducts = useTranslations('products');
  const [provider, setProvider] = useState('mock');
  const [productLine, setProductLine] = useState<ProductLineName>('ROBLOX_ROBUX');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [fields, setFields] = useState<SourceFieldValues>(EMPTY_SOURCE_FIELDS);
  const create = useApiAction(inventoryService.create);

  async function submit() {
    const result = await create.run({
      ...toSourcePayload(fields),
      provider: provider.trim(),
      productLine,
      openingBalance: openingBalance || '0',
    });
    if (result.ok) {
      setOpen(false);
      setFields(EMPTY_SOURCE_FIELDS);
      setOpeningBalance('0');
      toast({ tone: 'success', title: t('created'), description: result.value.name });
      router.refresh();
    }
  }

  return (
    <>
      <Button size="md" icon="add" onClick={() => setOpen(true)}>
        {t('newSource')}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            size="md"
            label={t('fields.provider')}
            hint={t('fields.providerHint')}
            required
            value={provider}
            onChange={(e) => setProvider(e.target.value.toLowerCase())}
          />
          <SelectField
            size="md"
            label={t('fields.productLine')}
            hint={t('fields.productLineHint')}
            value={productLine}
            onChange={(e) => setProductLine(e.target.value as ProductLineName)}
            options={PRODUCT_LINES.map((line) => ({
              value: line,
              label: tProducts(`productLine.${line}`),
            }))}
          />
          <TextField
            size="md"
            label={t('fields.openingBalance')}
            inputMode="numeric"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>
        <SourceFields values={fields} onChange={setFields} />
        <ApiErrorAlert code={create.errorCode} />
      </FormDialog>
    </>
  );
}
