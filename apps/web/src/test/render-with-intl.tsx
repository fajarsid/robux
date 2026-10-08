import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import messages from '../../messages/id.json';

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="id" messages={messages} timeZone="Asia/Jakarta">
      {children}
    </NextIntlClientProvider>
  );
}

/**
 * Renders with the real Indonesian catalog, so tests also catch missing message keys. The catalog
 * is a wrapper, so `rerender` keeps it.
 */
export function renderWithIntl(ui: ReactElement) {
  return render(ui, { wrapper: IntlWrapper });
}
