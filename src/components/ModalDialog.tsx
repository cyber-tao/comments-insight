import * as React from 'react';

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  closedBy?: 'any' | 'closerequest' | 'none';
  className?: string;
  children: React.ReactNode;
}

function isPointerOutsideDialog(
  dialog: HTMLDialogElement,
  event: React.PointerEvent<HTMLDialogElement>,
): boolean {
  const rect = dialog.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return event.target === dialog;
  }
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

/**
 * Native top-layer modal wrapper using `HTMLDialogElement.showModal()`,
 * progressive-enhanced `closedby`, and a pointer-outside fallback for Chrome 116–133.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  closedBy = 'any',
  className,
  children,
}) => {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const closingFromPropRef = React.useRef(false);
  const pointerDownOutsideRef = React.useRef(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) {
      return;
    }

    dialog.setAttribute('closedby', closedBy);
    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        closingFromPropRef.current = true;
        dialog.close();
        closingFromPropRef.current = false;
      }
      dialog.returnValue = '';
    };
  }, [open, closedBy]);

  if (!open) {
    return null;
  }

  const supportsNativeClosedBy =
    typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>): void => {
    if (closedBy === 'none') {
      event.preventDefault();
      return;
    }
    if (event.currentTarget.open) {
      event.currentTarget.close();
    }
  };

  const handleClose = (event: React.SyntheticEvent<HTMLDialogElement>): void => {
    event.currentTarget.returnValue = '';
    pointerDownOutsideRef.current = false;
    if (!closingFromPropRef.current) {
      onCloseRef.current();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDialogElement>): void => {
    if (closedBy !== 'any' || supportsNativeClosedBy) {
      pointerDownOutsideRef.current = false;
      return;
    }
    pointerDownOutsideRef.current = isPointerOutsideDialog(event.currentTarget, event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDialogElement>): void => {
    const startedOutside = pointerDownOutsideRef.current;
    pointerDownOutsideRef.current = false;
    if (
      startedOutside &&
      closedBy === 'any' &&
      !supportsNativeClosedBy &&
      isPointerOutsideDialog(event.currentTarget, event) &&
      event.currentTarget.open
    ) {
      event.currentTarget.close();
    }
  };

  const handlePointerCancel = (): void => {
    pointerDownOutsideRef.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={className ? `theme-modal ${className}` : 'theme-modal'}
      onCancel={handleCancel}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {children}
    </dialog>
  );
};

export default ModalDialog;
