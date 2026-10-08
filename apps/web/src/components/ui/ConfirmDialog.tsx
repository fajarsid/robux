'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Short consequence statement, e.g. "Tindakan ini tidak dapat dibatalkan." */
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for destructive or irreversible actions (cancel, deactivate, delete). */
  tone?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Every confirmation, destructive or not. Actions are never executed straight from a click. */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      busy={loading}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="text-muted-foreground">{children}</div>}
    </Dialog>
  );
}
