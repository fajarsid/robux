import type {
  AdminProductDetailView,
  CreatePriceVersionRequest,
  PriceQuoteView,
} from '@robux/shared';
import { apiGet, apiSend } from '@/lib/api/browser-api';

export const pricingService = {
  /** The backend total for `quantity` units, with the price version it is based on. */
  quote: (slug: string, quantity: number) =>
    apiGet<PriceQuoteView>(`/products/${encodeURIComponent(slug)}/quote?quantity=${quantity}`),

  /** Appends a new price version; the API rejects stale `basedOnVersion` values. */
  createVersion: (productId: string, request: CreatePriceVersionRequest) =>
    apiSend<AdminProductDetailView>('POST', `/admin/products/${productId}/prices`, request),
};
