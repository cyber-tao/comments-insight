import * as React from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export type ConfirmFunction = (opts: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Async equivalent of `window.confirm`. Returns a `confirm(opts)` function
 * that resolves with the user's choice, plus a `ConfirmHost` element that
 * must be rendered once near the page root. Multiple concurrent calls queue
 * sequentially.
 */
export function useConfirm(): {
  confirm: ConfirmFunction;
  ConfirmHost: React.FC;
} {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);
  const pendingRef = React.useRef<PendingConfirm | null>(null);
  const queueRef = React.useRef<PendingConfirm[]>([]);

  const setActivePending = React.useCallback((entry: PendingConfirm | null) => {
    pendingRef.current = entry;
    setPending(entry);
  }, []);

  const next = React.useCallback(() => {
    const upcoming = queueRef.current.shift() ?? null;
    setActivePending(upcoming);
  }, [setActivePending]);

  const confirm = React.useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const entry: PendingConfirm = { ...opts, resolve };
        if (pendingRef.current) {
          queueRef.current.push(entry);
        } else {
          setActivePending(entry);
        }
      }),
    [setActivePending],
  );

  const handleResolve = React.useCallback(
    (result: boolean) => {
      pendingRef.current?.resolve(result);
      next();
    },
    [next],
  );

  React.useEffect(() => {
    const queue = queueRef.current;
    return () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
      for (const queued of queue.splice(0)) {
        queued.resolve(false);
      }
    };
  }, []);

  const ConfirmHost = React.useCallback(
    () => (
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        destructive={pending?.destructive}
        onConfirm={() => handleResolve(true)}
        onCancel={() => handleResolve(false)}
      />
    ),
    [pending, handleResolve],
  );

  return { confirm, ConfirmHost };
}
