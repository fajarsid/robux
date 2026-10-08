import { getRequestConfig } from 'next-intl/server';

/**
 * D-09: Bahasa Indonesia is the default and only shipped locale for now. Adding English later
 * means adding `messages/en.json` and a locale resolver here; components already read every
 * user-facing string from the message catalog.
 */
export const DEFAULT_LOCALE = 'id';

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    timeZone: 'Asia/Jakarta',
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
