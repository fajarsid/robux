import type { ComponentProps } from 'react';

export function PageContainer({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`} {...props} />;
}
