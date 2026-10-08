/** Every staff console URL in one place. The API keeps its own `/api/v1/admin/*` namespace. */
export const CONSOLE_ROUTES = {
  home: '/console',
  login: '/console/login',
  orders: '/console/orders',
  order: (id: string) => `/console/orders/${encodeURIComponent(id)}`,
  products: '/console/products',
  product: (id: string) => `/console/products/${encodeURIComponent(id)}`,
  pricing: '/console/pricing',
  inventory: '/console/inventory',
  security: '/console/security',
} as const;
