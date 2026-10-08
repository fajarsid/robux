'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TextField } from '@/components/forms/TextField';
import { Alert } from '@/components/feedback/Alert';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { FormDialog } from '@/components/ui/FormDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { formatMoney } from '@/lib/format/format';
import { pricingService } from '../services/pricing.service';

const digits = (value: string) => value.replace(/[^\d]/g, '');

/**
 * New price version in two steps: enter, then review (with the below-cost warning) and save. The
 * below-cost check is a UX hint; the API applies the authoritative rules (whole rupiah, positive,
 * explicit below-cost confirmation, stale-version rejection).
 */
export function NewPriceDialog({
  product,
  onClose,
}: {
  product: { id: string; name: string; latestVersion: number; currency: string };
  onClose: () => void;
}) {
  const t = useTranslations('pricing');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const save = useApiAction(pricingService.createVersion);
  const belowCost =
    sellingPrice !== '' && costPrice !== '' && Number(sellingPrice) < Number(costPrice);

  async function submit() {
    if (step === 'edit') {
      setStep('review');
      return;
    }
    const result = await save.run(product.id, {
      sellingPrice,
      costPrice,
      basedOnVersion: product.latestVersion,
      ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
      ...(belowCost ? { confirmBelowCost: true } : {}),
    });
    if (result.ok) {
      onClose();
      toast({ tone: 'success', title: t('saved'), description: product.name });
      router.refresh();
    } else {
      setStep('edit');
    }
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      onCancel={step === 'review' ? () => setStep('edit') : onClose}
      title={step === 'edit' ? t('newPriceTitle') : t('confirmTitle')}
      description={step === 'edit' ? t('newPriceHint') : product.name}
      submitLabel={step === 'edit' ? tCommon('review') : t('confirm')}
      cancelLabel={step === 'edit' ? tCommon('cancel') : tCommon('back')}
      submitting={save.state === 'loading'}
      submitDisabled={!sellingPrice || !costPrice}
      onSubmit={submit}
    >
      {step === 'edit' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              size="md"
              label={t('sellingPrice')}
              inputMode="numeric"
              required
              value={sellingPrice}
              onChange={(e) => setSellingPrice(digits(e.target.value))}
            />
            <TextField
              size="md"
              label={t('costPrice')}
              inputMode="numeric"
              required
              value={costPrice}
              onChange={(e) => setCostPrice(digits(e.target.value))}
            />
          </div>
          <TextField
            size="md"
            label={t('scheduleLabel')}
            hint={t('scheduleHint')}
            type="datetime-local"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
          {belowCost && <Alert tone="warning">{t('belowCostWarning')}</Alert>}
          <ApiErrorAlert code={save.errorCode} />
        </>
      ) : (
        <>
          <p className="text-muted-foreground">
            {t('confirmBody', {
              selling: formatMoney(sellingPrice, product.currency),
              cost: formatMoney(costPrice, product.currency),
              version: product.latestVersion + 1,
            })}
          </p>
          {belowCost && <Alert tone="warning">{t('belowCostWarning')}</Alert>}
        </>
      )}
    </FormDialog>
  );
}
