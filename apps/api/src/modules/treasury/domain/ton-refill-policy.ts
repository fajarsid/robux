export interface TonRefillPolicy {
  minBalanceNano: bigint;
  targetBalanceNano: bigint;
  maxRefillNano: bigint;
  dailyLimitNano: bigint;
  allowedDestinationAddresses: readonly string[];
}

export type TonRefillDecision =
  | { kind: 'SUFFICIENT' }
  | { kind: 'REQUEST'; amountNano: bigint }
  | { kind: 'MANUAL_REVIEW'; reason: 'DESTINATION_NOT_ALLOWED' | 'REFILL_LIMIT' | 'DAILY_LIMIT' };

/** Pure threshold policy. Amounts are integer nanoTON to avoid floating point money arithmetic. */
export function evaluateTonRefill(input: {
  balanceNano: bigint;
  dailyRefillNano: bigint;
  destinationAddress: string;
  policy: TonRefillPolicy;
}): TonRefillDecision {
  const { balanceNano, dailyRefillNano, destinationAddress, policy } = input;
  if (
    balanceNano < 0n ||
    dailyRefillNano < 0n ||
    policy.minBalanceNano < 0n ||
    policy.targetBalanceNano <= policy.minBalanceNano ||
    policy.maxRefillNano <= 0n ||
    policy.dailyLimitNano <= 0n
  )
    throw new Error('Invalid TON treasury policy input');
  if (balanceNano >= policy.minBalanceNano) return { kind: 'SUFFICIENT' };
  if (!destinationAddress || !policy.allowedDestinationAddresses.includes(destinationAddress)) {
    return { kind: 'MANUAL_REVIEW', reason: 'DESTINATION_NOT_ALLOWED' };
  }
  const amountNano = policy.targetBalanceNano - balanceNano;
  if (amountNano > policy.maxRefillNano) return { kind: 'MANUAL_REVIEW', reason: 'REFILL_LIMIT' };
  if (dailyRefillNano + amountNano > policy.dailyLimitNano)
    return { kind: 'MANUAL_REVIEW', reason: 'DAILY_LIMIT' };
  return { kind: 'REQUEST', amountNano };
}
