import { Inject, Injectable } from '@nestjs/common';
import type { OrderCreatedView } from '@robux/shared';
import type { SecretCipher } from '../../../common/security/aes-gcm-secret.cipher';

export const ORDER_REPLAY_CIPHER = Symbol('ORDER_REPLAY_CIPHER');

type SealedOrderCreatedView = Omit<OrderCreatedView, 'trackingToken' | 'orderId'> & {
  trackingTokenSealed: { ciphertext: string; keyVersion: number };
};

/**
 * The order-creation response is stored so a retried request gets the same answer, but the guest
 * tracking token must never be stored in plaintext: it is kept encrypted (AES-256-GCM) only inside
 * the idempotency record, for the replay window.
 */
@Injectable()
export class ReplayableResponseCodec {
  constructor(@Inject(ORDER_REPLAY_CIPHER) private readonly cipher: SecretCipher) {}

  seal(view: Omit<OrderCreatedView, 'orderId'>): Record<string, unknown> {
    const { trackingToken, ...rest } = view;
    const sealed: SealedOrderCreatedView = {
      ...rest,
      trackingTokenSealed: {
        ciphertext: this.cipher.encrypt(Buffer.from(trackingToken, 'utf8')).toString('base64'),
        keyVersion: this.cipher.keyVersion,
      },
    };
    return sealed as unknown as Record<string, unknown>;
  }

  open(stored: Record<string, unknown>): OrderCreatedView {
    const { trackingTokenSealed, ...rest } = stored as unknown as SealedOrderCreatedView;
    const token = this.cipher
      .decrypt(
        Buffer.from(trackingTokenSealed.ciphertext, 'base64'),
        trackingTokenSealed.keyVersion,
      )
      .toString('utf8');
    return { ...rest, trackingToken: token };
  }
}
