'use client';

import { cancelOrderRequestSchema } from '@robux/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TextareaField } from '@/components/forms/TextareaField';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { adminOrdersService } from '../services/admin-orders.service';

/**
 * Staff cancellation with a mandatory reason (audited by the API). Success is confirmed with a
 * toast, which outlives the refresh that follows; a refusal stays inline next to the action.
 */
export function CancelOrderAction({
  orderId,
  orderNumber,
  cancellable,
}: {
  orderId: string;
  orderNumber: string;
  cancellable: boolean;
}) {
  const t = useTranslations('adminOrders.cancel');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [showInvalid, setShowInvalid] = useState(false);
  const cancel = useApiAction(adminOrdersService.cancel);
  const parsed = cancelOrderRequestSchema.safeParse({ reason });

  async function confirm() {
    if (!parsed.success) {
      setShowInvalid(true);
      return;
    }
    const result = await cancel.run(orderId, parsed.data.reason);
    setOpen(false);
    if (result.ok) {
      toast({ tone: 'success', title: t('success'), description: orderNumber });
    }
    // Success or not, show the API's current state: another staff member may have acted first.
    router.refresh();
  }

  function close() {
    setOpen(false);
    setShowInvalid(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <ApiErrorAlert code={cancel.errorCode} />
      {cancellable && (
        <>
          <Button
            variant="danger"
            size="md"
            className="self-start"
            onClick={() => {
              setReason('');
              setOpen(true);
            }}
          >
            {t('button')}
          </Button>
          <ConfirmDialog
            open={open}
            title={t('title')}
            tone="danger"
            confirmLabel={t('confirm')}
            cancelLabel={t('keep')}
            loading={cancel.state === 'loading'}
            onConfirm={confirm}
            onCancel={close}
          >
            <p>{t('body', { orderNumber })}</p>
            <TextareaField
              label={t('reason')}
              hint={t('reasonHint')}
              error={showInvalid && !parsed.success ? t('reasonInvalid') : undefined}
              value={reason}
              maxLength={500}
              required
              disabled={cancel.state === 'loading'}
              onChange={(event) => setReason(event.target.value)}
              className="mt-4"
            />
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
