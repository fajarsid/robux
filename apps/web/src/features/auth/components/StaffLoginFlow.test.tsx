import type { SessionView } from '@robux/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { authService } from '../services/auth.service';
import { StaffLoginFlow } from './StaffLoginFlow';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock('../services/auth.service', () => ({
  authService: { loginStaff: vi.fn(), session: vi.fn(), verifyTwoFactor: vi.fn() },
}));

const staffSession = (twoFactor: 'NOT_ENROLLED' | 'PENDING' | 'VERIFIED'): SessionView => ({
  authenticated: true,
  user: { id: 's1', email: 'staff@example.test', name: null, role: 'ADMIN' },
  twoFactor,
  csrfToken: 'csrf',
  expiresAt: '2026-10-05T12:00:00.000Z',
});

async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.test' } });
  fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'pw-not-checked' } });
  fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
}

describe('StaffLoginFlow', () => {
  beforeEach(() => {
    replace.mockReset();
    vi.mocked(authService.loginStaff).mockResolvedValue(undefined);
  });

  it('goes straight to the console for staff without 2FA', async () => {
    vi.mocked(authService.session).mockResolvedValue(staffSession('NOT_ENROLLED'));
    renderWithIntl(<StaffLoginFlow initialStep="password" />);
    await signIn();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/console'));
    expect(screen.queryByLabelText('Kode verifikasi')).toBeNull();
  });

  it('asks for the TOTP code when the account has 2FA enabled', async () => {
    vi.mocked(authService.session).mockResolvedValue(staffSession('PENDING'));
    renderWithIntl(<StaffLoginFlow initialStep="password" />);
    await signIn();
    expect(await screen.findByLabelText('Kode verifikasi')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
