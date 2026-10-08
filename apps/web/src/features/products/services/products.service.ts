import type {
  AdminProductDetailView,
  CreateProductRequest,
  UpdateProductRequest,
} from '@robux/shared';
import { apiSend } from '@/lib/api/browser-api';

export const productsService = {
  create: (request: CreateProductRequest) =>
    apiSend<AdminProductDetailView>('POST', '/admin/products', request),

  update: (id: string, changes: UpdateProductRequest) =>
    apiSend<AdminProductDetailView>('PATCH', `/admin/products/${id}`, changes),

  setActive: (id: string, active: boolean) =>
    apiSend<AdminProductDetailView>(
      'POST',
      `/admin/products/${id}/${active ? 'activate' : 'deactivate'}`,
    ),
};
