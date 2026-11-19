import * as React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import Toast, { ToastType } from '../components/Toast';
import { LIMITS } from '@/config/constants';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

export const useToast = () => {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextIdRef = useRef(0);
  const toastsRef = useRef<ToastMessage[]>(toasts);
  toastsRef.current = toasts;
  const listenersRef = useRef(new Set<() => void>());
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    listenersRef.current.forEach((listener) => listener());
  }, [toasts]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      // Bound the visible queue so a burst of errors does not stack toasts
      // off-screen indefinitely; oldest entries are dropped first.
      return next.length > LIMITS.MAX_TOASTS ? next.slice(next.length - LIMITS.MAX_TOASTS) : next;
    });
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const ToastContainer = useMemo(() => {
    const subscribe = (listener: () => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    };
    const getSnapshot = () => toastsRef.current;

    const ToastRegion: React.FC = () => {
      const activeToasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const containerRef = useRef<HTMLDivElement | null>(null);
      const open = activeToasts.length > 0;

      useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const supportsPopover =
          typeof container.showPopover === 'function' &&
          typeof container.hidePopover === 'function';
        if (supportsPopover) {
          container.setAttribute('popover', 'manual');
          try {
            if (open) {
              container.showPopover();
            } else {
              container.hidePopover();
            }
          } catch {
            // Ignore already-open / already-closed states or detached nodes
          }
        }
      }, [open]);

      return (
        <div
          ref={containerRef}
          role="region"
          aria-label={tRef.current('common.notifications')}
          data-open={open ? 'true' : 'false'}
          className="toast-popover-region"
        >
          {activeToasts.map((toast) => (
            <Toast
              key={toast.id}
              message={toast.message}
              type={toast.type}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>
      );
    };

    return ToastRegion;
  }, [removeToast]);

  return {
    showToast,
    ToastContainer,
    success: (message: string) => showToast(message, 'success'),
    error: (message: string) => showToast(message, 'error'),
    warning: (message: string) => showToast(message, 'warning'),
    info: (message: string) => showToast(message, 'info'),
  };
};
