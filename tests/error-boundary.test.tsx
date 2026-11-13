/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { Logger } from '../src/utils/logger';

vi.mock('../src/utils/logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/utils/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

const BrokenChild: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Boom during render');
  }
  return <div>Healthy child content</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no render error occurs', () => {
    render(
      <ErrorBoundary>
        <BrokenChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Healthy child content')).toBeTruthy();
  });

  it('renders default fallback, logs the error, invokes onError, and reloads on click', () => {
    const onError = vi.fn();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(
      <ErrorBoundary onError={onError}>
        <BrokenChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('errors.renderFailed')).toBeTruthy();
    expect(screen.getByText('errors.renderRecovery')).toBeTruthy();
    expect(screen.getByText('Boom during render')).toBeTruthy();
    expect(Logger.error).toHaveBeenCalledWith(
      '[ErrorBoundary] UI rendering error',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Boom during render' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.reloadPage' }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error screen</div>}>
        <BrokenChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error screen')).toBeTruthy();
    expect(screen.queryByText('errors.renderFailed')).toBeNull();
  });
});
