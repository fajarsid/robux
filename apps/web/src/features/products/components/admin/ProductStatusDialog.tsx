'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ApiErrorAlert } from '@/components/feedback/ApiErrorAlert';
import { useToast } from '@/components/feedback/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useApiAction } from '@/hooks/useApiAction';
import { productsService } from '../../services/products.service';

/** Confirmation for activating or deactivating a product (deactivation is the destructive one). */
export function ProductStatusDialog({
  productId,
  productName,
  isActive,
  onClose,
}: {
  productId: string;
  productName: string;
  isActive: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('adminProducts');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const toast = useToast();
  const toggle = useApiAction(productsService.setActive);

  async function confirm() {
    if ((await toggle.run(productId, !isActive)).ok) {
      onClose();
      toast({
        tone: 'success',
        title: isActive ? t('deactivated') : t('activated'),
        description: productName,
      });
      router.refresh();
    }
  }

  return (
    <ConfirmDialog
      open
      tone={isActive ? 'danger' : 'default'}
      title={isActive ? t('deactivate') : t('activate')}
      description={productName}
      confirmLabel={isActive ? t('deactivate') : t('activate')}
      cancelLabel={tCommon('cancel')}
      loading={toggle.state === 'loading'}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <p>{isActive ? t('deactivateConfirm') : t('activateConfirm')}</p>
      <div className="mt-3">
        <ApiErrorAlert code={toggle.errorCode} />
      </div>
    </ConfirmDialog>
  );
}
