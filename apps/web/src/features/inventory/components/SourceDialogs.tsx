'use client';

import type { AdminSourceView } from '@robux/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TextField } from '@/components/forms/TextField';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { inventoryService } from '../services/inventory.service';
import { SourceFields, sourceFieldValuesOf, toSourcePayload } from './SourceFields';

interface DialogProps {
  source: AdminSourceView;
  onClose: () => void;
}

/** Edit with the same fields as creation; the provider is fixed once allocations may refer to it. */
export function EditSourceDialog({ source, onClose }: DialogProps) {
  const t = useTranslations('adminInventory');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const [fields, setFields] = useState(() => sourceFieldValuesOf(source));
  const update = useApiAction(inventoryService.update);

  async function submit() {
    if ((await update.run(source.id, toSourcePayload(fields))).ok) {
      onClose();
      toast({ tone: 'success', title: t('saved'), description: fields.name });
      router.refresh();
    }
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('editTitle')}
      description={source.provider}
      submitLabel={t('save')}
      cancelLabel={tCommon('cancel')}
      submitting={update.state === 'loading'}
      size="lg"
      onSubmit={submit}
    >
      <SourceFields values={fields} onChange={setFields} />
      <p className="text-xs text-muted-foreground">{t('providerLocked')}</p>
      <ApiErrorAlert code={update.errorCode} />
    </FormDialog>
  );
}

/** Manual stock correction; the API refuses anything that would make the balance negative. */
export function AdjustBalanceDialog({ source, onClose }: DialogProps) {
  const t = useTranslations('adminInventory');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const adjust = useApiAction(inventoryService.adjust);

  async function submit() {
    if ((await adjust.run(source.id, { delta, reason: reason.trim() })).ok) {
      onClose();
      toast({ tone: 'success', title: t('adjusted'), description: source.name });
      router.refresh();
    }
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('adjustTitle')}
      description={t('adjustHint')}
      submitLabel={t('adjust')}
      cancelLabel={tCommon('cancel')}
      submitting={adjust.state === 'loading'}
      onSubmit={submit}
    >
      <TextField
        size="md"
        label={t('fields.delta')}
        inputMode="numeric"
        required
        value={delta}
        onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''))}
      />
      <TextField
        size="md"
        label={t('fields.reason')}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <ApiErrorAlert code={adjust.errorCode} />
    </FormDialog>
  );
}

/** Kill switch with confirmation. Disabling never cancels allocations a source already holds. */
export function SourceStatusDialog({ source, onClose }: DialogProps) {
  const t = useTranslations('adminInventory');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const active = source.status === 'ACTIVE';
  const toggle = useApiAction(inventoryService.setActive);

  async function confirm() {
    if ((await toggle.run(source.id, !active)).ok) {
      onClose();
      toast({
        tone: 'success',
        title: active ? t('deactivated') : t('activated'),
        description: source.name,
      });
      router.refresh();
    }
  }

  return (
    <ConfirmDialog
      open
      tone={active ? 'danger' : 'default'}
      title={active ? t('deactivate') : t('activate')}
      description={source.name}
      confirmLabel={active ? t('deactivate') : t('activate')}
      cancelLabel={tCommon('cancel')}
      loading={toggle.state === 'loading'}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <p>{active ? t('deactivateConfirm') : t('activateConfirm')}</p>
      <div className="mt-3">
        <ApiErrorAlert code={toggle.errorCode} />
      </div>
    </ConfirmDialog>
  );
}
