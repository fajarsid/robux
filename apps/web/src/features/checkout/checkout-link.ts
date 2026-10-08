/** Checkout carries only what was chosen; the price is quoted again by the API on that page. */
export function checkoutHref(slug: string, quantity: number): string {
  const params = new URLSearchParams({ product: slug, quantity: String(quantity) });
  return `/checkout?${params.toString()}`;
}

/** Parses the quantity from the URL; anything that is not a positive integer falls back. */
export function parseCheckoutQuantity(value: string | undefined, fallback: number): number {
  if (!value || !/^\d{1,3}$/.test(value)) {
    return fallback;
  }
  const quantity = Number(value);
  return quantity > 0 ? quantity : fallback;
}
