import { useTranslations } from 'next-intl';

/** Contact email plus account type; no other customer data is shown to staff here. */
export function OrderCustomerLabel({
  customer,
}: {
  customer: { contactEmail: string; guest: boolean };
}) {
  const t = useTranslations('adminOrders');
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{customer.contactEmail}</p>
      <p className="text-xs text-muted-foreground">
        {customer.guest ? t('guest') : t('registered')}
      </p>
    </div>
  );
}
