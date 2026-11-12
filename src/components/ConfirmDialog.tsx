import * as React from 'react';
import { useTranslation } from 'react-i18next';

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight, dependency-free confirm dialog. Replaces `window.confirm`,
 * which is synchronous, blocks the renderer, and ignores the application's
 * theme/i18n. Renders an accessible modal with focus on the confirm button
 * and supports Escape to dismiss.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    confirmButtonRef.current?.focus();
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const confirmText = confirmLabel ?? t('common.confirm');
  const cancelText = cancelLabel ?? t('common.cancel');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? confirmText}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 backdrop-blur-[1px]"
      onClick={onCancel}
    >
      <div
        className="rounded-xl p-5 max-w-sm w-[90%] mx-4 animate-fade-in"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
        )}
        <p
          className="text-sm leading-relaxed whitespace-pre-line"
          style={{ color: 'var(--text-secondary)' }}
        >
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="theme-button-secondary px-3.5 py-1.5 text-sm"
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? 'px-3.5 py-1.5 text-sm rounded-lg font-medium text-white transition-colors'
                : 'theme-button-primary px-3.5 py-1.5 text-sm'
            }
            style={
              destructive
                ? {
                    backgroundColor: 'var(--accent-danger)',
                  }
                : undefined
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
