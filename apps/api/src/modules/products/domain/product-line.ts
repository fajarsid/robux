import type {
  FulfillmentTypeName,
  PlatformName,
  ProductFulfillmentView,
  ProductLineName,
  RecipientTypeName,
  ProductUnitName,
} from '@robux/shared';

export interface ProductLineProfile {
  platform: PlatformName;
  fulfillmentType: FulfillmentTypeName;
  /** The identity the customer names at checkout, or null when items go to the order itself. */
  recipientType: RecipientTypeName | null;
  unit: ProductUnitName;
}

/**
 * The single place that says how each product line is fulfilled (ADR-009). Everything else
 * derives from it: checkout validation, the order snapshot, the fulfillment strategy and which
 * sources may serve an order. Adding a product line is one row here plus a database enum value.
 */
const PRODUCT_LINES: Readonly<Record<ProductLineName, ProductLineProfile>> = {
  ROBLOX_ROBUX: {
    platform: 'ROBLOX',
    fulfillmentType: 'BALANCE_PURCHASE',
    recipientType: 'ROBLOX_USER',
    unit: 'ROBUX',
  },
  TELEGRAM_PREMIUM: {
    platform: 'TELEGRAM',
    fulfillmentType: 'RECIPIENT_FULFILLMENT',
    recipientType: 'TELEGRAM_USER',
    unit: 'PREMIUM_MONTH',
  },
  TELEGRAM_STARS: {
    platform: 'TELEGRAM',
    fulfillmentType: 'RECIPIENT_FULFILLMENT',
    recipientType: 'TELEGRAM_USER',
    unit: 'STAR',
  },
  TELEGRAM_ACCOUNT: {
    platform: 'TELEGRAM',
    fulfillmentType: 'DIGITAL_DELIVERY',
    recipientType: null,
    unit: 'ACCOUNT',
  },
};

export function productLineProfile(line: ProductLineName): ProductLineProfile {
  return PRODUCT_LINES[line];
}

export function productFulfillmentOf(line: ProductLineName): ProductFulfillmentView {
  return { productLine: line, ...PRODUCT_LINES[line] };
}
