'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { Alert } from '@/components/feedback/Alert';
import { useToast } from '@/components/feedback/Toast';
import { Panel } from '@/components/layout/Panel';
import { Button } from '@/components/ui/Button';
import { TwoFactorEnrollment } from '@/features/auth/components/TwoFactorEnrollment';

/**
 * Optional staff 2FA. `enabled` comes from the session the API reports (VERIFIED vs NOT_ENROLLED).
 * Turning 2FA off and issuing new recovery codes have no API yet, so they are shown as
 * unavailable instead of pretending to work.
 */
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations('console.security');
  const router = useRouter();
  const toast = useToast();
  const [enrolling, setEnrolling] = useState(false);
  const unavailableId = useId();

  function finishEnrollment() {
    setEnrolling(false);
    toast({ tone: 'success', title: t('enabledToast') });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={t('twoFactorTitle')}
        description={t('twoFactorDescription')}
        actions={
          <StatusBadge tone={enabled ? 'success' : 'attention'}>
            {enabled ? t('statusOn') : t('statusOff')}
          </StatusBadge>
        }
      >
        {enabled ? (
          <p className="text-sm text-muted-foreground">{t('onBody')}</p>
        ) : enrolling ? (
          <TwoFactorEnrollment onComplete={finishEnrollment} />
        ) : (
          <div className="flex flex-col gap-4">
            <Alert>{t('offBody')}</Alert>
            <Button size="md" className="self-start" onClick={() => setEnrolling(true)}>
              {t('enable')}
            </Button>
          </div>
        )}
      </Panel>
      {enabled && (
        <Panel title={t('manageTitle')}>
          <ul className="flex flex-col divide-y divide-border text-sm">
            <li className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div>
                <p className="font-medium">{t('recoveryTitle')}</p>
                <p className="mt-0.5 text-muted-foreground">{t('recoveryBody')}</p>
              </div>
              <Button size="sm" variant="outline" disabled aria-describedby={unavailableId}>
                {t('regenerate')}
              </Button>
            </li>
            <li className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div>
                <p className="font-medium">{t('disableTitle')}</p>
                <p className="mt-0.5 text-muted-foreground">{t('disableBody')}</p>
              </div>
              <Button size="sm" variant="danger" disabled aria-describedby={unavailableId}>
                {t('disable')}
              </Button>
            </li>
          </ul>
          <p id={unavailableId} className="mt-4 text-xs text-muted-foreground">
            {t('unavailableNote')}
          </p>
        </Panel>
      )}
    </div>
  );
}
