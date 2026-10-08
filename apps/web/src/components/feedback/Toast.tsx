'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { FEEDBACK_TONES, type FeedbackTone } from './feedback-tone';

type ToastTone = FeedbackTone;

interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

type ShowToast = (toast: Omit<ToastMessage, 'id'>) => void;

const ToastContext = createContext<ShowToast | null>(null);

const DISMISS_AFTER_MS = 5000;

/**
 * Transient confirmation of an action ("Pesanan dibatalkan"). Lives above page content, so the
 * message survives the router refresh that usually follows a mutation. Errors that block the
 * user stay inline next to the form instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ShowToast>((toast) => {
    nextId.current += 1;
    setToasts((current) => [...current.slice(-2), { ...toast, id: nextId.current }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const t = useTranslations('common.toast');
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  const style = FEEDBACK_TONES[toast.tone];
  return (
    <div
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-panel border bg-surface py-3 pr-2 pl-4 text-sm shadow-overlay ${style.border}`}
    >
      <Icon name={style.icon} size="md" className={style.iconClass} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="font-medium">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-muted-foreground">{toast.description}</p>}
      </div>
      <IconButton icon="close" label={t('dismiss')} size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}

/** Outside a provider (e.g. storefront pages) toasts are a no-op rather than an error. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  return useMemo(() => show ?? (() => undefined), [show]);
}
