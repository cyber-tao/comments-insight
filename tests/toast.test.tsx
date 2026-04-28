// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useToast } from '../src/hooks/useToast';

function ToastHarness() {
  const toast = useToast();
  const ToastContainer = toast.ToastContainer;

  return (
    <>
      <button
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
  it('stacks multiple toasts through container positioning', () => {
    render(<ToastHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Show toasts' }));

    const alerts = screen.getAllByRole('alert');

    expect(alerts).toHaveLength(2);
    expect(alerts[0].parentElement?.style.position).toBe('fixed');
    expect(alerts[1].parentElement?.style.position).toBe('fixed');
    expect(alerts[0].parentElement?.style.top).toBe('16px');
    expect(alerts[1].parentElement?.style.top).toBe('96px');
    expect(alerts[0].className).not.toContain('fixed');
    expect(alerts[1].className).not.toContain('fixed');
  });
});
