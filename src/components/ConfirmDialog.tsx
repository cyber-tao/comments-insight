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

  const confirmText = confirmLabel ?? t('common.confirm', { defaultValue: 'Confirm' });
  const cancelText = cancelLabel ?? t('common.cancel', { defaultValue: 'Cancel' });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? confirmText}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-md shadow-xl p-5 max-w-sm w-[90%] mx-4"
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <h2 className="text-base font-semibold mb-2 text-gray-900 dark:text-gray-100">{title}</h2>
        )}
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? 'px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white'
                : 'px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white'
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
