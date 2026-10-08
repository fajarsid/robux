'use client';

import type { AccountProfileView } from '@robux/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { authService } from '@/features/auth/services/auth.service';
import { useApiAction } from '@/hooks/useApiAction';
import { CONSOLE_ROUTES } from '../routes';

export type ConsoleStaff = Pick<AccountProfileView, 'email' | 'name' | 'role'>;

/** Signed-in staff member, a link to account security and sign-out. */
export function UserMenu({ staff }: { staff: ConsoleStaff }) {
  const t = useTranslations('console.userMenu');
  const tRoles = useTranslations('console.roles');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const logout = useApiAction(authService.logout);
  const displayName = staff.name ?? staff.email;

  async function signOut() {
    await logout.run();
    router.replace(CONSOLE_ROUTES.login);
    router.refresh();
  }

  return (
    <DropdownMenu
      label={t('open')}
      header={
        <>
          <p className="truncate text-sm font-medium">{staff.email}</p>
          <p className="text-xs text-muted-foreground">{tRoles(staff.role)}</p>
        </>
      }
      items={[
        { label: t('security'), icon: 'security', href: CONSOLE_ROUTES.security },
        {
          label: tAuth('logout'),
          icon: 'logout',
          tone: 'danger',
          disabled: logout.state === 'loading',
          onSelect: () => void signOut(),
        },
      ]}
      trigger={(props) => (
        <button
          type="button"
          aria-label={t('open')}
          className="flex items-center gap-2.5 rounded-panel px-2 py-1.5 text-left hover:bg-muted"
          {...props}
        >
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="max-w-48 truncate text-sm font-medium">{displayName}</span>
            <span className="text-xs text-muted-foreground">{tRoles(staff.role)}</span>
          </span>
        </button>
      )}
    />
  );
}
