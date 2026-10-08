import type {
  AdjustSourceBalanceRequest,
  AdminSourceView,
  CreateSourceRequest,
  UpdateSourceRequest,
  CreateDigitalAccountInventoryRequest,
  DigitalAccountInventoryView,
} from '@robux/shared';
import { apiSend } from '@/lib/api/browser-api';

const base = '/admin/inventory/sources';

export const inventoryService = {
  listAccountItems: () =>
    import('@/lib/api/browser-api').then(({ apiGet }) =>
      apiGet<DigitalAccountInventoryView[]>('/admin/inventory/accounts'),
    ),
  createAccountItem: (request: CreateDigitalAccountInventoryRequest) =>
    apiSend<{ id: string; status: string }>('POST', '/admin/inventory/accounts', request),
  blockAccountItem: (id: string) =>
    apiSend<{ status: string }>('POST', `/admin/inventory/accounts/${id}/block`),
  create: (request: CreateSourceRequest) => apiSend<AdminSourceView>('POST', base, request),

  update: (id: string, changes: UpdateSourceRequest) =>
    apiSend<AdminSourceView>('PATCH', `${base}/${id}`, changes),

  setActive: (id: string, active: boolean) =>
    apiSend<AdminSourceView>('POST', `${base}/${id}/${active ? 'activate' : 'deactivate'}`),

  adjust: (id: string, request: AdjustSourceBalanceRequest) =>
    apiSend<AdminSourceView>('POST', `${base}/${id}/adjustments`, request),
};
