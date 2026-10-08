import { GatewayRejectedError } from '../../domain/payment-gateway';

/**
 * Expiry rules per method from docs/integrations/duitku.md §6. `max: null` means the documented
 * maximum is open-ended (">1440 minutes"); `fixed` means Duitku ignores the requested value.
 */
interface DuitkuMethodExpiry {
  maxMinutes: number | null;
  fixedMinutes?: number;
}

const VIRTUAL_ACCOUNT: DuitkuMethodExpiry = { maxMinutes: null };
const RETAIL: DuitkuMethodExpiry = { maxMinutes: null };
const QRIS: DuitkuMethodExpiry = { maxMinutes: 60 };
const TOKOPEDIA: DuitkuMethodExpiry = { maxMinutes: 1440 };

/**
 * Methods the adapter can serve with the fields we send (docs/integrations/duitku.md §9). Card
 * (VC) and paylater (DN, AT) need customerDetail; account links (OL, SL) need a credential code.
 */
const SUPPORTED_METHODS: Readonly<Record<string, DuitkuMethodExpiry>> = {
  BC: VIRTUAL_ACCOUNT,
  M2: VIRTUAL_ACCOUNT,
  VA: VIRTUAL_ACCOUNT,
  I1: VIRTUAL_ACCOUNT,
  B1: VIRTUAL_ACCOUNT,
  BT: VIRTUAL_ACCOUNT,
  A1: VIRTUAL_ACCOUNT,
  AG: VIRTUAL_ACCOUNT,
  NC: VIRTUAL_ACCOUNT,
  BR: VIRTUAL_ACCOUNT,
  S1: VIRTUAL_ACCOUNT,
  DM: VIRTUAL_ACCOUNT,
  BV: VIRTUAL_ACCOUNT,
  FT: RETAIL,
  IR: RETAIL,
  OV: { maxMinutes: 1440 },
  SA: { maxMinutes: 60 },
  LF: { maxMinutes: 1440, fixedMinutes: 24 },
  LA: { maxMinutes: 1440, fixedMinutes: 24 },
  DA: { maxMinutes: 1440 },
  SP: QRIS,
  SQ: QRIS,
  NQ: { maxMinutes: 1440 },
  JP: { maxMinutes: 10 },
  T1: TOKOPEDIA,
  T2: TOKOPEDIA,
  T3: TOKOPEDIA,
};

export function isSupportedDuitkuMethod(code: string): boolean {
  return Object.hasOwn(SUPPORTED_METHODS, code);
}

/**
 * The `expiryPeriod` to send so the attempt closes within `allowedMinutes`. A method whose fixed
 * window is longer would stay payable after the order expires, so it is refused instead.
 */
export function duitkuExpiryMinutes(code: string, allowedMinutes: number): number {
  const rule = SUPPORTED_METHODS[code];
  if (!rule) {
    throw new GatewayRejectedError('METHOD_UNAVAILABLE', code);
  }
  if (rule.fixedMinutes !== undefined) {
    if (rule.fixedMinutes > allowedMinutes) {
      throw new GatewayRejectedError('WINDOW_TOO_SHORT', code);
    }
    return rule.fixedMinutes;
  }
  return rule.maxMinutes === null ? allowedMinutes : Math.min(allowedMinutes, rule.maxMinutes);
}
