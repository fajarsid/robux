'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiSend } from '@/lib/api/browser-api';

type HandoffTarget =
  { kind: 'customer'; orderId: string } | { kind: 'guest'; trackingToken: string };
interface Credentials {
  username: string;
  password: string;
  recoveryInfo?: string;
}

export function AccountHandoff({ target }: { target: HandoffTarget }) {
  const [items, setItems] = useState<Credentials[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function reveal() {
    setLoading(true);
    setFailed(false);
    try {
      const result =
        target.kind === 'customer'
          ? await apiSend<Credentials[]>(
              'POST',
              `/me/orders/${encodeURIComponent(target.orderId)}/handoff`,
            )
          : await apiSend<Credentials[]>('POST', '/track/handoff', {
              trackingToken: target.trackingToken,
            });
      setItems(result);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="rounded-panel border border-border p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        Account details are shown only after you request them. Keep them private.
      </p>
      {!items ? (
        <>
          <Button type="button" loading={loading} onClick={() => void reveal()}>
            Reveal account details
          </Button>
          {failed && (
            <p role="alert" className="mt-2 text-sm text-danger">
              Unable to load account details. Try again later.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <dl key={index} className="grid gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Username</dt>
                <dd className="select-all font-mono">{item.username}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Password</dt>
                <dd className="select-all font-mono">{item.password}</dd>
              </div>
              {item.recoveryInfo && (
                <div>
                  <dt className="text-muted-foreground">Recovery information</dt>
                  <dd className="select-all font-mono">{item.recoveryInfo}</dd>
                </div>
              )}
            </dl>
          ))}
        </div>
      )}
    </section>
  );
}
