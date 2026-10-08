'use client';

import type { AdminProductView, AdminSourceView, DigitalAccountInventoryView } from '@robux/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/data-display/DataTable';
import { useClientPagination } from '@/components/data-display/useClientPagination';
import { EmptyState } from '@/components/feedback/EmptyState';
import { TextField } from '@/components/forms/TextField';
import { inventoryService } from '../services/inventory.service';

export function DigitalAccountInventory({
  initialItems,
  products,
  sources,
}: {
  initialItems: DigitalAccountInventoryView[];
  products: AdminProductView[];
  sources: AdminSourceView[];
}) {
  const [items, setItems] = useState(initialItems);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryInfo, setRecoveryInfo] = useState('');
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const filteredItems =
    statusFilter === 'ALL' ? items : items.filter((item) => item.status === statusFilter);
  const { pageRows, pagination } = useClientPagination(filteredItems);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(false);
    try {
      await inventoryService.createAccountItem({
        productId,
        sourceId,
        username,
        password,
        ...(recoveryInfo ? { recoveryInfo } : {}),
      });
      setPassword('');
      setRecoveryInfo('');
      setUsername('');
      setItems(await inventoryService.listAccountItems());
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }
  async function block(item: DigitalAccountInventoryView) {
    try {
      await inventoryService.blockAccountItem(item.id);
      setItems(await inventoryService.listAccountItems());
    } catch {
      setError(true);
    }
  }
  const columns: DataTableColumn<DigitalAccountInventoryView>[] = [
    { id: 'number', header: 'No.', cell: (item) => pageRows.indexOf(item) + 1 },
    { id: 'product', header: 'Product', cell: (item) => item.productName },
    { id: 'status', header: 'Status', cell: (item) => item.status },
    { id: 'source', header: 'Source', cell: (item) => item.sourceName },
    {
      id: 'createdAt',
      header: 'Created At',
      cell: (item) => new Date(item.createdAt).toLocaleString(),
    },
    {
      id: 'updatedAt',
      header: 'Updated At',
      cell: (item) => new Date(item.updatedAt).toLocaleString(),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (item) =>
        item.status === 'AVAILABLE' ? (
          <Button size="sm" variant="secondary" onClick={() => void block(item)}>
            Block
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="mt-8 flex flex-col gap-5">
      <h2 className="text-xl font-semibold">Telegram account inventory</h2>
      <Card>
        <form onSubmit={create} className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Product
            <select
              className="h-10 rounded-md border border-border bg-surface px-3"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Source
            <select
              className="h-10 rounded-md border border-border bg-surface px-3"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Account username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="off"
          />
          <TextField
            label="Account password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <TextField
            label="Recovery information (optional)"
            type="password"
            value={recoveryInfo}
            onChange={(e) => setRecoveryInfo(e.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-col justify-end gap-2">
            <Button type="submit" loading={saving} disabled={!productId || !sourceId}>
              Add encrypted account
            </Button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                Inventory action failed.
              </p>
            )}
          </div>
        </form>
      </Card>
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        Status filter
        <select
          className="h-10 rounded-md border border-border bg-surface px-3"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          {['AVAILABLE', 'RESERVED', 'SOLD', 'DELIVERED', 'BLOCKED'].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <DataTable
        caption="Telegram account inventory"
        columns={columns}
        rows={pageRows}
        rowKey={(item) => item.id}
        pagination={pagination}
        empty={<EmptyState icon="products" title="No account inventory yet" />}
      />
    </div>
  );
}
