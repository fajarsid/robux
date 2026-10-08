import type { PaymentView } from '@robux/shared';
import { useTranslations } from 'next-intl';
import { buttonClassName } from '@/components/ui/button-styles';
import { formatMoney } from '@/lib/format/format';
import { safeExternalUrl } from '../payment-links';

/**
 * How to pay this attempt. The gateway's hosted page shows the account number or QR code, so
 * this renders only what the API returns: amount, method and the link to that page.
 */
export function PaymentInstructions({ payment }: { payment: PaymentView }) {
  const t = useTranslations('payment');
  const paymentUrl = safeExternalUrl(payment.paymentUrl);
  return (
    <div className="flex flex-col gap-5">
      <dl className="flex flex-col gap-3">
        <div>
          <dt className="text-sm text-muted-foreground">{t('pending.amount')}</dt>
          <dd className="text-3xl font-semibold tabular-nums">
            {formatMoney(payment.amount, payment.currency)}
          </dd>
        </div>
        {payment.paymentMethod && (
          <div>
            <dt className="text-sm text-muted-foreground">{t('pending.method')}</dt>
            <dd className="font-medium">{payment.paymentMethod}</dd>
          </div>
        )}
      </dl>
      {paymentUrl && (
        <div className="flex flex-col gap-2">
          {/* noreferrer: the guest tracking token in this page's URL must not reach the gateway. */}
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName('primary')}
          >
            {t('instructions.openGateway')}
          </a>
          <p className="text-xs text-muted-foreground">{t('instructions.openGatewayHint')}</p>
        </div>
      )}
    </div>
  );
}
