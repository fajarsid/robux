'use client';

import type { ReactNode } from 'react';
import { useOrderListNavigation } from '../hooks/useOrderListNavigation';
import type { AdminOrderListView } from '../types/admin-orders';
import { OrderTable } from './OrderTable';

/** The server-paged order list: page and page size live in the URL (one API request per page). */
export function OrderListTable({ list, empty }: { list: AdminOrderListView; empty: ReactNode }) {
  const { pending, navigate } = useOrderListNavigation();
  return (
    <OrderTable
      orders={list.items}
      empty={empty}
      pagination={{
        page: list.page,
        pageSize: list.pageSize,
        total: list.total,
        pending,
        onPageChange: (page) => navigate({ page }),
        onPageSizeChange: (pageSize) => navigate({ pageSize }),
      }}
    />
  );
}
