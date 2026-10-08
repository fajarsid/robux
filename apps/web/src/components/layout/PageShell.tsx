import type { ReactNode } from 'react';
import { PageContainer } from './PageContainer';
import { SiteHeader } from './SiteHeader';

export function PageShell({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <SiteHeader />
      <main>
        <PageContainer className={className}>{children}</PageContainer>
      </main>
    </>
  );
}
