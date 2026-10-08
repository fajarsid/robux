import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { TwoFactorSettings } from './TwoFactorSettings';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/features/auth/services/auth.service', () => ({
  authService: { beginTwoFactorEnrollment: vi.fn(), activateTwoFactor: vi.fn() },
}));

describe('TwoFactorSettings', () => {
  it('offers to enable optional 2FA when it is off', () => {
    renderWithIntl(<TwoFactorSettings enabled={false} />);
    expect(screen.getByText('Tidak aktif')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aktifkan verifikasi dua langkah' }));
    // The existing enrollment step (secret, code, one-time recovery codes) takes over.
    expect(screen.getByRole('button', { name: 'Mulai aktivasi' })).toBeTruthy();
  });

  it('shows 2FA as on and keeps unsupported actions visibly unavailable', () => {
    renderWithIntl(<TwoFactorSettings enabled />);
    expect(screen.getByText('Aktif')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Buat kode baru' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/belum didukung server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aktifkan verifikasi dua langkah' })).toBeNull();
  });
});
