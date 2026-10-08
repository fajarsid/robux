import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/ui/ButtonLink';

export async function HeroSection() {
  const t = await getTranslations('home');
  return (
    <section className="py-16 sm:py-24">
      <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        {t('title')}
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {t('subtitle')}
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/products">{t('primaryCta')}</ButtonLink>
        <ButtonLink href="/order" variant="outline">
          {t('secondaryCta')}
        </ButtonLink>
      </div>
    </section>
  );
}
