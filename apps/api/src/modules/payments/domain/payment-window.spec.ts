import { gatewayCloseDeadline } from './payment-window';

const now = new Date('2026-10-05T10:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe('gatewayCloseDeadline', () => {
  it('closes the gateway attempt five minutes before the order deadline', () => {
    expect(gatewayCloseDeadline(minutes(60), now)).toEqual(minutes(55));
  });

  it('refuses when less than five minutes would remain to pay', () => {
    expect(gatewayCloseDeadline(minutes(10), now)).toEqual(minutes(5));
    expect(gatewayCloseDeadline(minutes(9), now)).toBeNull();
    expect(gatewayCloseDeadline(minutes(-1), now)).toBeNull();
  });

  it('refuses an order without a payment deadline', () => {
    expect(gatewayCloseDeadline(null, now)).toBeNull();
  });
});
