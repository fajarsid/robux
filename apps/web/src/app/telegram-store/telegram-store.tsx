'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type MiniApp = {
  initData: string;
  ready(): void;
  expand(): void;
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
};
declare global {
  interface Window {
    Telegram?: { WebApp?: MiniApp };
  }
}
type Product = {
  id: string;
  slug: string;
  name: string;
  minQuantity: number;
  price: { amount: string; currency: string; versionId: string; starsAmount?: number | null };
  availability: 'AVAILABLE' | 'OUT_OF_STOCK';
};
type Order = {
  reference: string;
  orderNumber: string;
  product?: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
  paymentStatus?: string | null;
  paymentExpiresAt?: string | null;
  handoffAvailable?: boolean;
};
type SecretAccount = { username: string; password: string; recoveryInfo?: string };

const api = '/api/v1/telegram/miniapp';

export default function TelegramStore() {
  const [initData, setInitData] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<{ code: string }[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [email, setEmail] = useState('');
  const [payment, setPayment] = useState<{
    status: string;
    paymentMethod: string | null;
    paymentUrl: string | null;
    paymentQrPayload: string | null;
    expiresAt: string | null;
  } | null>(null);
  const [account, setAccount] = useState<SecretAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'home' | 'orders'>('home');
  const orderIdempotencyKeys = useRef(new Map<string, string>());
  const paymentIdempotencyKeys = useRef(new Map<string, string>());

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    script.onload = () => {
      const webApp = window.Telegram?.WebApp;
      if (webApp?.initData) {
        webApp.ready();
        webApp.expand();
        if (webApp.colorScheme) document.documentElement.dataset.theme = webApp.colorScheme;
        setInitData(webApp.initData);
        if (new URLSearchParams(window.location.search).get('view') === 'orders') setView('orders');
      }
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
      setAccount(null);
    };
  }, []);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`${api}${path}`, {
        ...init,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          Authorization: `tma ${initData}`,
          ...(init.headers ?? {}),
        },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeError(data));
      return data as T;
    },
    [initData],
  );

  const refreshCatalog = useCallback(async () => {
    if (!initData) return;
    try {
      setProducts(await request<Product[]>('/catalog'));
    } catch (e) {
      setError(errorText(e));
    }
  }, [initData, request]);
  const refreshOrders = useCallback(async () => {
    if (!initData) return;
    try {
      setOrders(await request<Order[]>('/orders'));
    } catch (e) {
      setError(errorText(e));
    }
  }, [initData, request]);

  useEffect(() => {
    if (!initData) return;
    let active = true;
    Promise.all([
      request<Product[]>('/catalog'),
      request<Order[]>('/orders'),
      request<{ methods: { code: string }[] }>('/payment-methods'),
    ])
      .then(([catalog, orderList, methods]) => {
        if (active) {
          setProducts(catalog);
          setOrders(orderList);
          setPaymentMethods(methods.methods);
          const linkedOrder = new URLSearchParams(window.location.search).get('order');
          if (linkedOrder) {
            void request<Order>(`/orders/${encodeURIComponent(linkedOrder)}`)
              .then((order) => {
                if (active) setActiveOrder(order);
              })
              .catch(() => {
                if (active) setError('Pesanan tidak ditemukan.');
              });
          }
        }
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [initData, request]);

  const activeOrderReference = activeOrder?.reference;
  useEffect(() => {
    if (!activeOrderReference || !initData || account) return;
    const timer = window.setInterval(async () => {
      try {
        const order = await request<Order>(`/orders/${encodeURIComponent(activeOrderReference)}`);
        setActiveOrder(order);
        if (order.status === 'FULFILLED') void refreshOrders();
        if (order.paymentStatus) {
          const current = await request<{
            status: string;
            paymentMethod: string | null;
            paymentUrl: string | null;
            paymentQrPayload: string | null;
            expiresAt: string | null;
          }>(`/orders/${encodeURIComponent(order.reference)}/payment`);
          setPayment(current);
        }
      } catch {
        /* Keep the last safe state; the next poll retries. */
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeOrderReference, initData, account, request, refreshOrders]);

  const availableProducts = useMemo(
    () => products.filter((p) => p.availability === 'AVAILABLE'),
    [products],
  );

  async function checkout() {
    if (!selected || !email.trim()) return;
    setBusy(true);
    setError('');
    const draftKey = `${selected.id}:${selected.price.versionId}`;
    let idempotencyKey = orderIdempotencyKeys.current.get(draftKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      orderIdempotencyKeys.current.set(draftKey, idempotencyKey);
    }
    try {
      const order = await request<Order>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          productId: selected.id,
          priceVersionId: selected.price.versionId,
          quantity: 1,
          contactEmail: email.trim(),
        }),
      });
      orderIdempotencyKeys.current.delete(draftKey);
      setAccount(null);
      setPayment(null);
      setActiveOrder(order);
      setSelected(null);
      await openPayment(order, selectedPaymentMethod);
      await refreshOrders();
    } catch (e) {
      setError(errorText(e));
      await refreshCatalog();
    } finally {
      setBusy(false);
    }
  }

  async function openPayment(order: Order, method: string) {
    if (!method) {
      setError('Pembayaran belum tersedia untuk lingkungan ini.');
      return;
    }
    const key = `${order.reference}:${method}`;
    let idempotencyKey = paymentIdempotencyKeys.current.get(key);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      paymentIdempotencyKeys.current.set(key, idempotencyKey);
    }
    const result = await request<{
      payment: {
        status: string;
        paymentMethod: string | null;
        paymentUrl: string | null;
        paymentQrPayload: string | null;
        expiresAt: string | null;
      };
    }>(`/orders/${encodeURIComponent(order.reference)}/payment`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ paymentMethod: method }),
    });
    paymentIdempotencyKeys.current.delete(key);
    setPayment(result.payment);
  }

  async function simulatePayment(outcome: 'PAID' | 'FAILED' | 'EXPIRED') {
    if (!activeOrder) return;
    setBusy(true);
    setError('');
    try {
      await request(`/orders/${encodeURIComponent(activeOrder.reference)}/mock-payment`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      });
      const order = await request<Order>(`/orders/${encodeURIComponent(activeOrder.reference)}`);
      setActiveOrder(order);
      setPayment(await request(`/orders/${encodeURIComponent(order.reference)}/payment`));
      await refreshOrders();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function revealAccount(order: Order) {
    setBusy(true);
    setError('');
    try {
      setAccount(
        await request<SecretAccount[]>(`/orders/${encodeURIComponent(order.reference)}/handoff`, {
          method: 'POST',
          body: '{}',
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!initData)
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center p-6">
        <section className="w-full rounded-3xl border border-border bg-surface p-6 text-center">
          <div className="mb-4 text-4xl">🛍️</div>
          <h1 className="text-xl font-semibold">Telegram Account Store</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Buka halaman ini melalui tombol toko di Telegram untuk melanjutkan.
          </p>
        </section>
      </main>
    );

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 pb-24 pt-6">
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">READY STOCK · INSTANT DELIVERY</p>
        <h1 className="mt-1 text-2xl font-bold">Telegram Account Store</h1>
      </header>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm"
        >
          {error}
        </div>
      )}
      {activeOrder ? (
        <section className="rounded-3xl border border-border bg-surface p-5">
          <button
            className="mb-4 text-sm text-muted-foreground"
            onClick={() => {
              setActiveOrder(null);
              setPayment(null);
              setAccount(null);
            }}
          >
            ← Kembali
          </button>
          <h2 className="text-xl font-semibold">Pesanan {activeOrder.orderNumber}</h2>
          <p className="mt-2">{activeOrder.product ?? 'Telegram Account'}</p>
          <p className="mt-1 font-semibold">{money(activeOrder.amount, activeOrder.currency)}</p>
          <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm">
            {statusLabel(activeOrder.status)}
          </p>
          {payment && (
            <div className="mt-4 rounded-2xl border border-border p-4">
              <h3 className="font-semibold">
                {payment.paymentMethod === 'MK' ? 'Pembayaran development' : 'Pembayaran'}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Status: {paymentStatusLabel(payment.status)}
                {payment.expiresAt
                  ? ` · berlaku sampai ${new Date(payment.expiresAt).toLocaleString('id-ID')}`
                  : ''}
              </p>
              {payment.paymentQrPayload && payment.status === 'PENDING' && (
                <details className="mt-3 rounded-xl bg-surface-muted p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Kode pembayaran QRIS
                  </summary>
                  <code className="mt-2 block max-h-24 overflow-auto break-all text-xs">
                    {payment.paymentQrPayload}
                  </code>
                  <button
                    className="mt-3 rounded-lg border border-border px-3 py-2 text-sm"
                    onClick={() =>
                      void navigator.clipboard?.writeText(payment.paymentQrPayload ?? '')
                    }
                  >
                    Salin kode pembayaran
                  </button>
                </details>
              )}
              {payment.paymentMethod === 'MK' && payment.status === 'PENDING' && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    disabled={busy}
                    onClick={() => void simulatePayment('PAID')}
                    className="rounded-xl bg-primary px-2 py-3 text-sm font-semibold text-primary-foreground"
                  >
                    Mock Paid
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void simulatePayment('FAILED')}
                    className="rounded-xl bg-muted px-2 py-3 text-sm"
                  >
                    Gagal
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void simulatePayment('EXPIRED')}
                    className="rounded-xl bg-muted px-2 py-3 text-sm"
                  >
                    Expired
                  </button>
                </div>
              )}
              {payment.paymentMethod === 'MK' && (
                <p className="mt-2 text-xs text-warning">
                  Simulasi lokal; tidak ada pembayaran nyata.
                </p>
              )}
              {payment.paymentMethod === 'TELEGRAM_STARS' && payment.status === 'PENDING' && (
                <p className="mt-3 rounded-xl bg-surface-muted p-3 text-sm">
                  Invoice Telegram Stars telah dikirim ke chat bot. Selesaikan pembayaran dari
                  invoice tersebut; status di sini diperbarui otomatis.
                </p>
              )}
              {payment.paymentMethod !== 'MK' && payment.paymentUrl && (
                <a
                  href={payment.paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block rounded-xl border border-border p-3 text-center text-sm"
                >
                  Buka instruksi pembayaran provider
                </a>
              )}
            </div>
          )}
          {(!payment || ['FAILED', 'EXPIRED', 'CANCELLED'].includes(payment.status)) &&
            activeOrder.status === 'PAYMENT_PENDING' &&
            selectedPaymentMethod && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void openPayment(activeOrder, selectedPaymentMethod)
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
                className="mt-4 w-full rounded-xl border border-border px-4 py-3 font-semibold"
              >
                {payment ? 'Buat pembayaran baru' : 'Coba siapkan pembayaran lagi'}
              </button>
            )}
          {activeOrder.handoffAvailable && !account && (
            <button
              disabled={busy}
              onClick={() => void revealAccount(activeOrder)}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground"
            >
              Buka Account
            </button>
          )}
          {account && (
            <div className="mt-4 rounded-2xl border border-success/40 bg-success/10 p-4">
              <h3 className="font-semibold">Account siap</h3>
              {account.map((item, index) => (
                <div key={index} className="mt-3 break-words text-sm">
                  <p>
                    Username: <strong>{item.username}</strong>
                  </p>
                  <p>
                    Password: <strong>{item.password}</strong>
                  </p>
                  {item.recoveryInfo && (
                    <p>
                      Recovery: <strong>{item.recoveryInfo}</strong>
                    </p>
                  )}
                </div>
              ))}
              <p className="mt-3 text-xs text-muted-foreground">
                Simpan informasi ini dengan aman. Data hanya ditampilkan pada layar ini.
              </p>
            </div>
          )}
        </section>
      ) : view === 'orders' ? (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pesanan Saya</h2>
            <button onClick={() => setView('home')} className="text-sm">
              Toko
            </button>
          </div>
          {orders.length === 0 ? (
            <p className="rounded-2xl bg-surface p-5 text-sm text-muted-foreground">
              Belum ada pesanan.
            </p>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <button
                  key={order.reference}
                  onClick={() => {
                    setAccount(null);
                    setPayment(null);
                    setActiveOrder(order);
                    void request<Order>(`/orders/${encodeURIComponent(order.reference)}`).then(
                      setActiveOrder,
                    );
                  }}
                  className="w-full rounded-2xl border border-border bg-surface p-4 text-left"
                >
                  <div className="flex justify-between gap-3">
                    <strong>{order.orderNumber}</strong>
                    <span className="text-sm">{money(order.amount, order.currency)}</span>
                  </div>
                  <p className="mt-1 text-sm">{order.product}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{order.status}</p>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-4">
          {products.length === 0 && (
            <article className="rounded-3xl border border-border bg-surface p-5">
              <h2 className="text-xl font-semibold">Telegram Account</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Produk belum tersedia. Silakan periksa kembali nanti.
              </p>
            </article>
          )}
          {products.map((product) => (
            <article
              key={product.id}
              className="overflow-hidden rounded-3xl border border-border bg-surface"
            >
              <div className="flex h-36 items-center justify-center bg-surface-muted text-6xl">
                ✈️
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{product.name}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Ready Stock · Secure handoff setelah fulfillment selesai.
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${product.availability === 'AVAILABLE' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
                  >
                    {product.availability === 'AVAILABLE' ? 'Available' : 'Stock habis'}
                  </span>
                </div>
                <p className="mt-5 text-2xl font-bold">
                  {money(product.price.amount, product.price.currency)}
                </p>
                {product.availability === 'AVAILABLE' &&
                  methodsFor(product, paymentMethods).length > 0 && (
                    <button
                      onClick={() => {
                        setSelected(product);
                        setSelectedPaymentMethod(
                          methodsFor(product, paymentMethods)[0]?.code ?? '',
                        );
                      }}
                      className="mt-4 w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground"
                    >
                      BELI SEKARANG
                    </button>
                  )}
                {product.availability === 'AVAILABLE' &&
                  methodsFor(product, paymentMethods).length === 0 && (
                    <p className="mt-4 rounded-xl bg-muted p-3 text-center text-sm text-muted-foreground">
                      Metode pembayaran belum tersedia untuk produk ini.
                    </p>
                  )}
              </div>
            </article>
          ))}
          {availableProducts.length === 0 && (
            <button
              onClick={() => void refreshCatalog()}
              className="w-full rounded-xl border border-border py-3"
            >
              Periksa stok lagi
            </button>
          )}
        </section>
      )}
      {selected && (
        <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/60 p-3">
          <section className="w-full max-w-lg rounded-3xl border border-border bg-background p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Checkout</h2>
              <button onClick={() => setSelected(null)} aria-label="Tutup">
                ✕
              </button>
            </div>
            <p className="mt-3">{selected.name}</p>
            <p className="mt-1 font-bold">
              {money(selected.price.amount, selected.price.currency)}
            </p>
            <fieldset className="mt-5 space-y-2">
              <legend className="mb-2 text-sm font-medium">Metode pembayaran</legend>
              {methodsFor(selected, paymentMethods).map((method) => (
                <label
                  key={method.code}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3"
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={method.code}
                    checked={selectedPaymentMethod === method.code}
                    onChange={() => setSelectedPaymentMethod(method.code)}
                  />
                  <span>{methodLabel(method.code)}</span>
                  {method.code === 'TELEGRAM_STARS' && (
                    <span className="ml-auto text-sm text-muted-foreground">
                      {selected.price.starsAmount} XTR
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
            <label className="mt-4 block text-sm">
              Email untuk bukti pesanan
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-3"
                placeholder="nama@email.com"
              />
            </label>
            <button
              disabled={busy || !email.includes('@') || !selectedPaymentMethod}
              onClick={() => void checkout()}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? 'Memproses…' : 'Buat Pesanan'}
            </button>
          </section>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg justify-around border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => {
            setView('home');
            void refreshCatalog();
          }}
        >
          ⌂<span className="ml-2">Toko</span>
        </button>
        <button
          onClick={() => {
            setView('orders');
            void refreshOrders();
          }}
        >
          ▤<span className="ml-2">Pesanan</span>
        </button>
      </nav>
    </main>
  );
}

function money(value: string, currency: string) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: currency || 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}
function methodsFor(product: Product, methods: { code: string }[]) {
  return methods.filter(
    (method) => method.code !== 'TELEGRAM_STARS' || (product.price.starsAmount ?? 0) > 0,
  );
}
function methodLabel(code: string) {
  if (code === 'TELEGRAM_STARS') return 'Telegram Stars';
  if (code === 'MK') return 'Development Payment';
  if (['SP', 'SQ', 'NQ', 'QRIS'].includes(code)) return `QRIS / Duitku (${code})`;
  return code;
}
function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PAYMENT_PENDING: 'Menunggu pembayaran',
    PAID: 'Pembayaran dikonfirmasi',
    QUEUED: 'Pesanan masuk antrean',
    PROCESSING: 'Pesanan sedang diproses',
    FULFILLMENT_PENDING: 'Pesanan sedang diproses',
    FULFILLED: 'Pesanan selesai',
    FAILED: 'Pesanan gagal, silakan hubungi support',
    FAILED_PERMANENTLY: 'Pesanan gagal, silakan hubungi support',
    CANCELLED: 'Pesanan dibatalkan',
    RECONCILIATION_REQUIRED: 'Pesanan memerlukan bantuan support',
  };
  return labels[status] ?? 'Pesanan sedang diproses';
}
function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: 'Menunggu pembayaran',
    PAID: 'Pembayaran dikonfirmasi',
    FAILED: 'Pembayaran gagal',
    EXPIRED: 'Pembayaran kedaluwarsa',
    CANCELLED: 'Pembayaran dibatalkan',
    REFUND_PENDING: 'Pengembalian dana diproses',
    REFUNDED: 'Dana dikembalikan',
  };
  return labels[status] ?? 'Status pembayaran diperbarui';
}
function safeError(data: unknown) {
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    const message = data.message.toLowerCase();
    if (message.includes('stok') || message.includes('unavailable'))
      return 'Stok account sudah habis.';
    if (message.includes('expired')) return 'Pembayaran sudah kedaluwarsa.';
  }
  return 'Terjadi masalah. Silakan coba lagi atau hubungi support.';
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Terjadi masalah. Silakan coba lagi.';
}
