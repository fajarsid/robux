import { ErrorCode, type RecipientTypeName } from '@robux/shared';
import type { CreateOrderRequest } from '@robux/shared';
import { DomainError } from '../../../common/errors/domain-error';

export interface OrderRecipient {
  type: RecipientTypeName;
  /** Username as the customer named it (Telegram without the leading "@"). */
  identifier: string;
}

const wrongRecipient = (message: string) => new DomainError(ErrorCode.VALIDATION_FAILED, message);

/**
 * Checks the recipient the customer sent against what the product needs. The product decides
 * (its line's recipient type, ADR-009); the request can only supply the identity, never choose how
 * the order is fulfilled. Digital delivery takes no recipient at all.
 */
export function resolveOrderRecipient(
  required: RecipientTypeName | null,
  recipient: CreateOrderRequest['recipient'],
): OrderRecipient | null {
  if (required === null) {
    if (recipient) {
      throw wrongRecipient('Produk ini dikirim ke pesanan Anda dan tidak memerlukan penerima.');
    }
    return null;
  }
  if (required === 'ROBLOX_USER' && recipient && 'robloxUsername' in recipient) {
    return { type: required, identifier: recipient.robloxUsername };
  }
  if (required === 'TELEGRAM_USER' && recipient && 'telegramUsername' in recipient) {
    return { type: required, identifier: recipient.telegramUsername };
  }
  throw wrongRecipient(
    required === 'ROBLOX_USER'
      ? 'Masukkan username Roblox penerima.'
      : 'Masukkan username Telegram penerima.',
  );
}
