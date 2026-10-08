'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { type CancelTarget, ordersService } from '../services/orders.service';

/** Cancels an unpaid order after confirmation, then reloads the server-rendered order. */
export function CancelOrderButton({ target }: { target: CancelTarget }) {
  const t = useTranslations('order.cancel');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const cancel = useApiAction(ordersService.cancel);

  async function confirm() {
    const result = await cancel.run(target);
    setOpen(false);
    if (result.ok) {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('button')}
      </Button>
      <ApiErrorAlert code={cancel.errorCode} />
      <ConfirmDialog
        open={open}
        title={t('title')}
        confirmLabel={t('confirm')}
        cancelLabel={t('keep')}
        loading={cancel.state === 'loading'}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      >
        {t('body')}
      </ConfirmDialog>
    </div>
  );
}
