import { loadTreasuryConfig } from './app-config';

describe('loadTreasuryConfig', () => {
  it('defaults to disabled with conservative TON thresholds', () => {
    expect(loadTreasuryConfig({})).toMatchObject({
      enabled: false,
      binanceWithdrawalEnabled: false,
      minBalanceNano: 20_000_000_000n,
      targetBalanceNano: 100_000_000_000n,
    });
  });
  it('requires a production authorization flag and rejects live withdrawal configuration', () => {
    expect(() =>
      loadTreasuryConfig({ NODE_ENV: 'production', TON_TREASURY_ENABLED: 'true' }),
    ).toThrow(/authorization/);
    expect(() => loadTreasuryConfig({ BINANCE_WITHDRAWAL_ENABLED: 'true' })).toThrow(
      /not implemented/,
    );
  });
  it('rejects invalid or inconsistent thresholds', () => {
    expect(() => loadTreasuryConfig({ TON_TREASURY_MIN_BALANCE_NANO: '20 TON' })).toThrow(
      /integer nanoTON/,
    );
    expect(() =>
      loadTreasuryConfig({
        TON_TREASURY_MIN_BALANCE_NANO: '100',
        TON_TREASURY_TARGET_BALANCE_NANO: '50',
      }),
    ).toThrow(/inconsistent/);
  });
});
