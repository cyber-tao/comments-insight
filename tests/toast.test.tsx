// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useToast } from '../src/hooks/useToast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function ToastHarness() {
  const toast = useToast();
  const ToastContainer = toast.ToastContainer;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast.info('First toast');
          toast.error('Second toast');
        }}
      >
        Show toasts
      </button>
      <ToastContainer />
    </>
  );
}

describe('useToast', () => {
  it('stacks multiple toasts inside a single region with appropriate live roles', () => {
    render(<ToastHarness />);

    const region = screen.getByRole('region', { name: 'common.notifications' });
    expect(region.getAttribute('data-open')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Show toasts' }));

    expect(region.getAttribute('data-open')).toBe('true');

    const statusToast = screen.getByRole('status');
    const errorToast = screen.getByRole('alert');

    expect(statusToast.textContent).toContain('First toast');
    expect(statusToast.getAttribute('aria-live')).toBe('polite');
    expect(errorToast.textContent).toContain('Second toast');
    expect(errorToast.getAttribute('aria-live')).toBe('assertive');

    expect(statusToast.parentElement).toBe(region);
    expect(errorToast.parentElement).toBe(region);
    expect(statusToast.className).not.toContain('fixed');
    expect(errorToast.className).not.toContain('fixed');
  });

  it('pauses auto-dismissal while hovered or focused and resumes after leaving', () => {
    vi.useFakeTimers();
    try {
      render(<ToastHarness />);

      fireEvent.click(screen.getByRole('button', { name: 'Show toasts' }));

      const statusToast = screen.getByRole('status');
      expect(screen.getByRole('alert')).not.toBeNull();
      const closeButton = statusToast.querySelector('button');
      if (!closeButton) {
        throw new Error('Expected close button on status toast');
      }

      // Hover pauses dismissal of info toast past default 3000ms duration
      fireEvent.mouseEnter(statusToast);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole('status')).not.toBeNull();
      // Non-hovered error toast dismissed after 3000ms
      expect(screen.queryByRole('alert')).toBeNull();

      // Focusing a child button also pauses while mouse leaves
      fireEvent.focus(closeButton);
      fireEvent.mouseLeave(statusToast);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole('status')).not.toBeNull();

      // Leaving focus resumes remaining dismiss time
      fireEvent.blur(closeButton, { relatedTarget: document.body });
      act(() => {
        vi.advanceTimersByTime(3500);
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses manual popover top-layer API when supported by the browser', () => {
    const originalShowPopover = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'showPopover',
    );
    const originalHidePopover = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'hidePopover',
    );
    const showPopoverSpy = vi.fn();
    const hidePopoverSpy = vi.fn();

    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true,
      writable: true,
      value: showPopoverSpy,
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true,
      writable: true,
      value: hidePopoverSpy,
    });

    try {
      render(<ToastHarness />);

      const container = document.querySelector('.toast-popover-region');
      expect(container?.getAttribute('popover')).toBe('manual');
      expect(hidePopoverSpy).toHaveBeenCalledTimes(1);
      expect(showPopoverSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Show toasts' }));
      expect(showPopoverSpy).toHaveBeenCalledTimes(1);

      const closeButtons = container?.querySelectorAll('button') ?? [];
      closeButtons.forEach((button) => {
        fireEvent.click(button);
      });
      expect(hidePopoverSpy).toHaveBeenCalledTimes(2);
    } finally {
      if (originalShowPopover) {
        Object.defineProperty(HTMLElement.prototype, 'showPopover', originalShowPopover);
      } else {
        delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover;
      }
      if (originalHidePopover) {
        Object.defineProperty(HTMLElement.prototype, 'hidePopover', originalHidePopover);
      } else {
        delete (HTMLElement.prototype as { hidePopover?: unknown }).hidePopover;
      }
    }
  });
});
