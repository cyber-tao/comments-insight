import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ModalDialog } from './ModalDialog';

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
 * Lightweight, dependency-free confirm dialog backed by a native top-layer `<dialog>`.
 * Focuses the cancel button by default for destructive actions (preventing accidental
 * Enter/Space confirmation) and the confirm button otherwise.
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
  const titleId = React.useId();
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    if (destructive) {
      cancelButtonRef.current?.focus();
    } else {
      confirmButtonRef.current?.focus();
    }
  }, [open, destructive]);

  const confirmText = confirmLabel ?? t('common.confirm');
  const cancelText = cancelLabel ?? t('common.cancel');

  return (
    <ModalDialog
      open={open}
      onClose={onCancel}
      ariaLabel={title ? undefined : confirmText}
      ariaLabelledBy={title ? titleId : undefined}
      className="w-[90%] max-w-sm animate-fade-in"
    >
      <div className="p-5">
        {title && (
          <h2
            id={titleId}
            className="text-base font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
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
            ref={cancelButtonRef}
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
    </ModalDialog>
  );
};

export default ConfirmDialog;
