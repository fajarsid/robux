'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { IconButton } from './IconButton';

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

const PLACEMENTS = {
  center:
    'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] rounded-panel border border-border bg-surface p-0 text-foreground shadow-overlay backdrop:bg-overlay',
  left: 'm-0 h-dvh max-h-dvh w-72 max-w-[85vw] bg-surface p-0 text-foreground shadow-overlay backdrop:bg-overlay',
} as const;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Hides the visual header (drawers whose content names itself); the title stays accessible. */
  hideHeader?: boolean;
  placement?: keyof typeof PLACEMENTS;
  size?: keyof typeof SIZES;
  /** Blocks Escape, backdrop and close button while an action is running. */
  busy?: boolean;
  /** Footer actions; omit when `children` render their own footer (FormDialog). */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The single overlay primitive: centred dialogs, forms, confirmations and the navigation drawer.
 * Native <dialog>: focus trapping, Escape, inertness of the page and the backdrop come from the
 * browser; focus returns to the opener when it closes. Colours and font are inherited.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  hideHeader = false,
  placement = 'center',
  size = 'sm',
  busy = false,
  footer,
  children,
}: DialogProps) {
  const t = useTranslations('common.dialog');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal?.();
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [open]);

  const requestClose = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
      className={`${PLACEMENTS[placement]} ${placement === 'center' ? SIZES[size] : ''}`}
    >
      <div className="flex max-h-[inherit] flex-col">
        {hideHeader ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              icon="close"
              label={t('close')}
              size="sm"
              onClick={requestClose}
              disabled={busy}
              className="-mr-2"
            />
          </header>
        )}
        {footer ? (
          <>
            <DialogBody>{children}</DialogBody>
            <DialogFooter>{footer}</DialogFooter>
          </>
        ) : (
          children
        )}
      </div>
    </dialog>
  );
}

/** Scrollable content area with the standard dialog padding. */
export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-6 py-4 text-sm">{children}</div>;
}

/** Action row: secondary action first, primary last; stacked on phones with primary on top. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}
