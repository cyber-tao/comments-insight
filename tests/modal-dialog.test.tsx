/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalDialog } from '../src/components/ModalDialog';

describe('ModalDialog', () => {
  it('opens a native modal dialog without redundant ARIA dialog attributes', () => {
    const onClose = vi.fn();
    render(
      <ModalDialog open onClose={onClose} ariaLabelledBy="modal-heading">
        <div>
          <h2 id="modal-heading">Test Modal</h2>
          <p>Modal content</p>
        </div>
      </ModalDialog>,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('closedby')).toBe('any');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('modal-heading');
    expect(dialog?.hasAttribute('role')).toBe(false);
    expect(dialog?.hasAttribute('aria-modal')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets returnValue on close and avoids double callback when closed via open prop', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalDialog open onClose={onClose} ariaLabel="Closing Test">
        <div>Body</div>
      </ModalDialog>,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error('Expected dialog');

    dialog.returnValue = 'stale';
    rerender(
      <ModalDialog open={false} onClose={onClose} ariaLabel="Closing Test">
        <div>Body</div>
      </ModalDialog>,
    );

    expect(dialog.returnValue).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('supports outside pointer light-dismiss without closing on drag-from-inside', () => {
    const onClose = vi.fn();
    render(
      <ModalDialog open onClose={onClose} ariaLabel="Light Dismiss">
        <div data-testid="modal-inner">Inner Content</div>
      </ModalDialog>,
    );

    const dialog = document.querySelector('dialog');
    const inner = screen.getByTestId('modal-inner');
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error('Expected dialog');

    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 300,
      top: 100,
      bottom: 300,
      width: 200,
      height: 200,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    // Dragging from inside box to outside backdrop must NOT close
    fireEvent.pointerDown(inner, { clientX: 150, clientY: 150 });
    fireEvent.pointerUp(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).not.toHaveBeenCalled();

    // Pointer down & up both outside rect MUST close
    fireEvent.pointerDown(dialog, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(dialog, { clientX: 25, clientY: 25 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prevents native cancel and light-dismiss when closedBy is none', () => {
    const onClose = vi.fn();
    render(
      <ModalDialog open onClose={onClose} closedBy="none" ariaLabel="Locked Modal">
        <div>Locked</div>
      </ModalDialog>,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog?.getAttribute('closedby')).toBe('none');
    if (!dialog) throw new Error('Expected dialog');

    const cancelEvent = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);

    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
