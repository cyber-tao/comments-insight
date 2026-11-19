/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ConfirmDialog', () => {
  it('resolves confirm and cancel button actions and focuses confirm by default', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(<ConfirmDialog open message="Delete item?" onConfirm={onConfirm} onCancel={onCancel} />);

    const confirmBtn = screen.getByRole('button', { name: 'common.confirm' });
    expect(document.activeElement).toBe(confirmBtn);

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('focuses cancel button by default when destructive is true', () => {
    render(
      <ConfirmDialog
        open
        title="Warning"
        message="Delete everything?"
        destructive
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: 'common.cancel' });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('cancels on native dialog cancel event and backdrop pointer dismiss', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(<ConfirmDialog open message="Delete item?" onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    if (!dialog) {
      throw new Error('Expected native <dialog> element');
    }

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Re-open or test pointer dismiss directly when closedby fallback triggers close
    render(<ConfirmDialog open message="Second?" onConfirm={onConfirm} onCancel={onCancel} />);
    const secondDialog = document.querySelectorAll('dialog')[1];
    fireEvent.pointerDown(secondDialog);
    fireEvent.pointerUp(secondDialog);

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
