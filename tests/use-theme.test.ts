/**
 * @vitest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../src/hooks/useTheme';

const extensionApiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

type MatchMediaListener = (event: MediaQueryListEvent) => void;

function createMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<MatchMediaListener>();

  return {
    api: vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_event: string, listener: MatchMediaListener) => listeners.add(listener),
      removeEventListener: (_event: string, listener: MatchMediaListener) =>
        listeners.delete(listener),
    })),
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('useTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('dark');
  });

  it('loads saved dark theme and updates document state', async () => {
    const matchMedia = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia.api,
    });
    extensionApiMock.getSettings.mockResolvedValue({ theme: 'dark' });

    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();
    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(result.current.isDark).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('tracks system theme changes and allows manual overrides', async () => {
    const matchMedia = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia.api,
    });
    extensionApiMock.getSettings.mockResolvedValue({ theme: 'system' });

    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      matchMedia.setMatches(true);
    });

    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => {
      result.current.setTheme('light');
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to default theme when settings load fails', async () => {
    const matchMedia = createMatchMedia(true);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia.api,
    });
    extensionApiMock.getSettings.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
