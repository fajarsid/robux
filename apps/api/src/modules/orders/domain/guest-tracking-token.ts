import {
  generateOpaqueToken,
  hashOpaqueToken,
  isWellFormedOpaqueToken,
  type OpaqueToken,
} from '../../../common/security/opaque-token';

export type GuestTrackingToken = OpaqueToken;

export const generateGuestTrackingToken = generateOpaqueToken;
export const hashGuestTrackingToken = hashOpaqueToken;
export const isWellFormedGuestTrackingToken = isWellFormedOpaqueToken;
