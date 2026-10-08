import { getTranslations } from 'next-intl/server';

const STEP_KEYS = ['account', 'product', 'payment', 'delivery'] as const;

export async function HowToBuySteps() {
  const t = await getTranslations('home');
  return (
    <section className="border-t border-border py-12" aria-labelledby="how-to-buy-title">
      <h2 id="how-to-buy-title" className="text-lg font-semibold">
        {t('steps.title')}
      </h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEP_KEYS.map((key, index) => (
          <li key={key} className="rounded-card border border-border bg-surface p-5">
            <span className="text-sm font-semibold text-primary">0{index + 1}</span>
            <p className="mt-2 text-sm text-foreground">{t(`steps.${key}`)}</p>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-sm text-muted-foreground">{t('safety')}</p>
    </section>
  );
}
