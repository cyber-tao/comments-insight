/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfirm, type ConfirmFunction } from '../src/hooks/useConfirm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderConfirmHarness(): {
  confirm: () => ConfirmFunction;
  unmount: () => void;
} {
  let confirmRef: ConfirmFunction | null = null;

  const Harness: React.FC = () => {
    const { confirm, ConfirmHost } = useConfirm();
    confirmRef = confirm;
    return <ConfirmHost />;
  };

  const rendered = render(<Harness />);

  return {
    confirm: () => {
      if (!confirmRef) {
        throw new Error('Confirm function was not initialized');
      }
      return confirmRef;
    },
    unmount: rendered.unmount,
  };
}

describe('useConfirm', () => {
  it('queues synchronous confirm calls and resolves them in order', async () => {
    const { confirm } = renderConfirmHarness();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;

    act(() => {
      first = confirm()({ message: 'First confirmation' });
      second = confirm()({ message: 'Second confirmation' });
    });

    expect(screen.getByText('First confirmation')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() => {
      expect(screen.getByText('Second confirmation')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it('resolves active and queued confirmations as false on unmount', async () => {
    const { confirm, unmount } = renderConfirmHarness();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;

    act(() => {
      first = confirm()({ message: 'First confirmation' });
      second = confirm()({ message: 'Second confirmation' });
    });

    unmount();

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });
});
