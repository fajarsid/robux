'use client';

import {
  type AdminProductView,
  type FulfillmentMethodName,
  PRODUCT_LINES,
  PRODUCT_QUANTITY_CEILING,
  type ProductLineName,
} from '@robux/shared';
import { useTranslations } from 'next-intl';
import { SelectField } from '@/components/forms/SelectField';
import { TextField } from '@/components/forms/TextField';

export interface ProductFieldValues {
  name: string;
  robuxAmount: string;
  fulfillmentMethod: FulfillmentMethodName;
  productLine: ProductLineName;
  minQuantity: string;
  maxQuantity: string;
  displayOrder: string;
}

export const EMPTY_PRODUCT_FIELDS: ProductFieldValues = {
  name: '',
  robuxAmount: '',
  fulfillmentMethod: 'INSTANT',
  productLine: 'ROBLOX_ROBUX',
  minQuantity: '1',
  maxQuantity: '10',
  displayOrder: '0',
};

export function fieldValuesOf(product: AdminProductView): ProductFieldValues {
  return {
    name: product.name,
    robuxAmount: String(product.robuxAmount),
    fulfillmentMethod: product.fulfillmentMethod,
    productLine: product.productLine,
    minQuantity: String(product.minQuantity),
    maxQuantity: String(product.maxQuantity),
    displayOrder: String(product.displayOrder),
  };
}

/** Product attributes shared by the create and edit dialogs. */
export function ProductFields({
  values,
  onChange,
  identityLocked = false,
}: {
  values: ProductFieldValues;
  onChange: (values: ProductFieldValues) => void;
  identityLocked?: boolean;
}) {
  const t = useTranslations('adminProducts.fields');
  const tProducts = useTranslations('products');
  const set = (field: keyof ProductFieldValues) => (value: string) =>
    onChange({ ...values, [field]: value });
  const digits = (value: string) => value.replace(/[^\d]/g, '');

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        size="md"
        label={t('name')}
        required
        value={values.name}
        onChange={(e) => set('name')(e.target.value)}
      />
      <SelectField
        size="md"
        label={t('productLine')}
        disabled={identityLocked}
        value={values.productLine}
        onChange={(e) => {
          const productLine = e.target.value as ProductLineName;
          // Gamepass is a Robux mechanism; other lines are always instant.
          onChange({
            ...values,
            productLine,
            fulfillmentMethod:
              productLine === 'ROBLOX_ROBUX' ? values.fulfillmentMethod : 'INSTANT',
          });
        }}
        options={PRODUCT_LINES.map((line) => ({
          value: line,
          label: tProducts(`productLine.${line}`),
        }))}
      />
      <TextField
        size="md"
        label={t('robuxAmount')}
        hint={t('robuxAmountHint')}
        inputMode="numeric"
        required
        disabled={identityLocked}
        value={values.robuxAmount}
        onChange={(e) => set('robuxAmount')(digits(e.target.value))}
      />
      <SelectField
        size="md"
        label={t('method')}
        disabled={identityLocked}
        value={values.fulfillmentMethod}
        onChange={(e) => set('fulfillmentMethod')(e.target.value)}
        options={(values.productLine === 'ROBLOX_ROBUX'
          ? (['INSTANT', 'GAMEPASS'] as const)
          : (['INSTANT'] as const)
        ).map((method) => ({
          value: method,
          label: tProducts(`method.${method}`),
        }))}
      />
      <TextField
        size="md"
        label={t('displayOrder')}
        inputMode="numeric"
        value={values.displayOrder}
        onChange={(e) => set('displayOrder')(digits(e.target.value))}
      />
      <TextField
        size="md"
        label={t('minQuantity')}
        inputMode="numeric"
        max={PRODUCT_QUANTITY_CEILING}
        value={values.minQuantity}
        onChange={(e) => set('minQuantity')(digits(e.target.value))}
      />
      <TextField
        size="md"
        label={t('maxQuantity')}
        inputMode="numeric"
        max={PRODUCT_QUANTITY_CEILING}
        value={values.maxQuantity}
        onChange={(e) => set('maxQuantity')(digits(e.target.value))}
      />
    </div>
  );
}

export function toProductPayload(values: ProductFieldValues) {
  return {
    name: values.name.trim(),
    robuxAmount: Number(values.robuxAmount),
    fulfillmentMethod: values.fulfillmentMethod,
    productLine: values.productLine,
    minQuantity: Number(values.minQuantity),
    maxQuantity: Number(values.maxQuantity),
    displayOrder: Number(values.displayOrder || 0),
  };
}
