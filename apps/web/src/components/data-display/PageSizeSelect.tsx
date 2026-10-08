'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { fieldControlClassName } from '@/components/forms/FormField';
import { PAGE_SIZE_OPTIONS } from './pagination-model';

/** "Tampilkan [10 ▾]": rows per page, 10 / 25 / 50 / 100. */
export function PageSizeSelect({
  pageSize,
  disabled = false,
  onChange,
}: {
  pageSize: number;
  disabled?: boolean;
  onChange: (pageSize: number) => void;
}) {
  const t = useTranslations('common.pagination');
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {t('show')}
      </label>
      {/* Fixed width: the control fills its box, which never shrinks in a crowded footer. */}
      <div className="w-20 shrink-0">
        <select
          id={id}
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className={fieldControlClassName('md', 'h-8 px-2')}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
