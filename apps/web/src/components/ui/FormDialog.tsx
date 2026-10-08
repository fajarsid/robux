'use client';

import type { FormEvent, ReactNode } from 'react';
import { Button } from './Button';
import { Dialog, DialogBody, DialogFooter } from './Dialog';

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  submitLabel: string;
  cancelLabel: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onSubmit: () => void;
  /** Secondary action; defaults to closing (multi-step forms use it to go back). */
  onCancel?: () => void;
  /** Fields and the inline error (ApiErrorAlert) of the form. */
  children: ReactNode;
}

/**
 * Create and edit operations: a Dialog whose body is a form. Enter submits, the submit button
 * shows progress, and the dialog cannot be dismissed while the request runs.
 */
export function FormDialog({
  open,
  onClose,
  title,
  description,
  submitLabel,
  cancelLabel,
  submitting = false,
  submitDisabled = false,
  size = 'md',
  onSubmit,
  onCancel,
  children,
}: FormDialogProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      busy={submitting}
    >
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
        <DialogBody>
          <div className="flex flex-col gap-4">{children}</div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="md" onClick={onCancel ?? onClose} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button type="submit" size="md" loading={submitting} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
