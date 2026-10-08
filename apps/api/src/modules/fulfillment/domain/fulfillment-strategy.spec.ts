import { PRODUCT_LINES } from '@robux/shared';
import { productLineProfile } from '../../products/domain/product-line';
import { fulfillmentStrategyFor } from './fulfillment-strategy';
import type { FulfillmentWorkflow } from './fulfillment-workflow.repository';

function workflow(overrides: Partial<FulfillmentWorkflow>): FulfillmentWorkflow {
  return {
    orderId: 'order-1',
    orderStatus: 'PROCESSING',
    method: 'INSTANT',
    productLine: 'ROBLOX_ROBUX',
    fulfillmentType: 'BALANCE_PURCHASE',
    recipient: { type: 'ROBLOX_USER', identifier: 'Builder_Kid', externalUserId: null },
    fulfillmentOrderId: 'fo-1',
    requestedAmount: 500,
    fulfilledAmount: 0,
    remainingAmount: 500,
    retriesUsed: 0,
    lastAttemptNumber: 0,
    referencesUsed: 0,
    latestAttempt: null,
    openAllocations: [],
    leaseToken: 'lease',
    ...overrides,
  };
}

describe('fulfillment strategy resolution', () => {
  it.each([
    ['DIGITAL_DELIVERY', 'DIGITAL_DELIVERY'],
    ['RECIPIENT_FULFILLMENT', 'RECIPIENT_FULFILLMENT'],
    ['BALANCE_PURCHASE', 'BALANCE_PURCHASE'],
  ] as const)('%s → %s strategy, the same one every time', (type, expected) => {
    expect(fulfillmentStrategyFor(type).type).toBe(expected);
    expect(fulfillmentStrategyFor(type)).toBe(fulfillmentStrategyFor(type));
  });

  it('every product line resolves to a strategy through its fulfillment type', () => {
    for (const line of PRODUCT_LINES) {
      const strategy = fulfillmentStrategyFor(productLineProfile(line).fulfillmentType);
      expect(strategy.type).toBe(productLineProfile(line).fulfillmentType);
    }
  });

  it('balance purchase (Robux) delivers to the Roblox recipient and validates it', () => {
    const strategy = fulfillmentStrategyFor('BALANCE_PURCHASE');
    expect(strategy.validatesRecipient).toBe(true);
    expect(strategy.targetOf(workflow({}))).toEqual({
      ok: true,
      recipient: { type: 'ROBLOX_USER', identifier: 'Builder_Kid', externalUserId: null },
    });
  });

  it('recipient fulfillment (Telegram Premium/Stars) needs a recipient', () => {
    const strategy = fulfillmentStrategyFor('RECIPIENT_FULFILLMENT');
    const telegram = workflow({
      productLine: 'TELEGRAM_STARS',
      fulfillmentType: 'RECIPIENT_FULFILLMENT',
      recipient: { type: 'TELEGRAM_USER', identifier: 'durov', externalUserId: null },
    });
    expect(strategy.validatesRecipient).toBe(true);
    expect(strategy.targetOf(telegram)).toMatchObject({
      ok: true,
      recipient: { identifier: 'durov' },
    });
    expect(strategy.targetOf({ ...telegram, recipient: null })).toEqual({ ok: false });
  });

  it('digital delivery (Telegram accounts) has no recipient and refuses one', () => {
    const strategy = fulfillmentStrategyFor('DIGITAL_DELIVERY');
    const account = workflow({
      productLine: 'TELEGRAM_ACCOUNT',
      fulfillmentType: 'DIGITAL_DELIVERY',
      recipient: null,
    });
    expect(strategy.validatesRecipient).toBe(false);
    expect(strategy.targetOf(account)).toEqual({ ok: true, recipient: null });
    expect(
      strategy.targetOf({
        ...account,
        recipient: { type: 'TELEGRAM_USER', identifier: 'someone', externalUserId: null },
      }),
    ).toEqual({ ok: false });
  });
});
