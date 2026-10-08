import { evaluateTonRefill } from './ton-refill-policy';

const policy = {
  minBalanceNano: 20_000_000_000n,
  targetBalanceNano: 100_000_000_000n,
  maxRefillNano: 100_000_000_000n,
  dailyLimitNano: 200_000_000_000n,
  allowedDestinationAddresses: ['treasury-wallet'],
};

describe('evaluateTonRefill', () => {
  it('does not refill while balance meets threshold', () => {
    expect(
      evaluateTonRefill({
        balanceNano: 20_000_000_000n,
        dailyRefillNano: 0n,
        destinationAddress: 'treasury-wallet',
        policy,
      }),
    ).toEqual({ kind: 'SUFFICIENT' });
  });
  it('requests only the amount needed to reach target', () => {
    expect(
      evaluateTonRefill({
        balanceNano: 10_000_000_000n,
        dailyRefillNano: 0n,
        destinationAddress: 'treasury-wallet',
        policy,
      }),
    ).toEqual({ kind: 'REQUEST', amountNano: 90_000_000_000n });
  });
  it('requires manual review for an unknown destination or a limit breach', () => {
    expect(
      evaluateTonRefill({
        balanceNano: 10_000_000_000n,
        dailyRefillNano: 0n,
        destinationAddress: 'attacker-wallet',
        policy,
      }),
    ).toEqual({ kind: 'MANUAL_REVIEW', reason: 'DESTINATION_NOT_ALLOWED' });
    expect(
      evaluateTonRefill({
        balanceNano: 10_000_000_000n,
        dailyRefillNano: 150_000_000_000n,
        destinationAddress: 'treasury-wallet',
        policy,
      }),
    ).toEqual({ kind: 'MANUAL_REVIEW', reason: 'DAILY_LIMIT' });
  });
});
