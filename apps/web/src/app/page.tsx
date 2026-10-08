import { PageShell } from '@/components/layout/PageShell';
import { HeroSection } from '@/features/landing/components/HeroSection';
import { HowToBuySteps } from '@/features/landing/components/HowToBuySteps';

export default function HomePage() {
  return (
    <PageShell>
      <HeroSection />
      <HowToBuySteps />
    </PageShell>
  );
}
