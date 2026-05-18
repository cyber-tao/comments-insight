/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Logs from '../src/logs/Logs';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  setMinLevel: vi.fn(),
}));

const confirmMock = vi.hoisted(() => vi.fn(async () => true));
const useConfirmMock = vi.hoisted(() =>
  vi.fn(() => ({
    confirm: confirmMock,
    ConfirmHost: () => null,
  })),
);

const useThemeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/logger')>();
  return {
    ...actual,
    Logger: loggerMock,
  };
});

vi.mock('../src/hooks/useConfirm', () => ({
  useConfirm: useConfirmMock,
}));

vi.mock('../src/hooks/useTheme', () => ({
  useTheme: useThemeMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultText: string) => defaultText,
  }),
}));

describe('Logs Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock chrome.storage
    const mockStorage: Record<string, unknown> = {
      ai_log_index: ['ai_log_1', 'ai_log_2'],
      system_log_index: ['log_sys_1'],
      ai_log_1: {
        type: 'extraction',
        timestamp: 1000,
        prompt: 'test prompt',
        response: 'test response',
      },
      ai_log_2: {
        type: 'analysis',
        timestamp: 2000,
        prompt: 'test prompt 2',
        response: 'test response 2',
      },
      log_sys_1: {
        level: 'ERROR',
        timestamp: 3000,
        message: 'system error message',
      },
      log_min_level: 'DEBUG',
    };

    global.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: string | string[]) => {
            if (typeof keys === 'string') return Promise.resolve({ [keys]: mockStorage[keys] });
            const result: Record<string, unknown> = {};
            keys.forEach((k) => {
              result[k] = mockStorage[k];
            });
            return Promise.resolve(result);
          }),
          set: vi.fn(),
          remove: vi.fn(),
        } as any,
      },
    } as any;
  });

  it('loads and renders logs successfully', async () => {
    render(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('AI Logs (2)')).toBeTruthy();
      expect(screen.getByText('System Logs (1)')).toBeTruthy();
    });

    // Switch to System Logs
    fireEvent.click(screen.getByText('System Logs (1)'));
    await waitFor(() => {
      expect(screen.getAllByText('system error message').length).toBeGreaterThan(0);
      expect(screen.getByText('Total: 1')).toBeTruthy();
      expect(screen.getByText('Errors: 1')).toBeTruthy();
    });
  });

  it('filters logs by type', async () => {
    render(<Logs />);

    // First we are on AI tab by default, wait for it to load
    await waitFor(() => expect(screen.getByText('AI Logs (2)')).toBeTruthy());

    // Switch to System Logs
    fireEvent.click(screen.getByText('System Logs (1)'));
    await waitFor(() => {
      expect(screen.getAllByText('system error message').length).toBeGreaterThan(0);
    });

    // Filter Error
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ERROR' } });
    expect(screen.getAllByText('system error message').length).toBeGreaterThan(0);
  });

  it('clears logs', async () => {
    render(<Logs />);
    await waitFor(() => expect(screen.getByText('AI Logs (2)')).toBeTruthy());

    fireEvent.click(screen.getByText(/Clear All/i));

    await waitFor(() => {
      expect(chrome.storage.local.remove).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.queryAllByText('system error message').length).toBe(0);
    });
  });

  it('handles log item expansion', async () => {
    render(<Logs />);
    await waitFor(() => expect(screen.getByText('AI Logs (2)')).toBeTruthy());

    // Switch to System Logs to find the system error message
    fireEvent.click(screen.getByText('System Logs (1)'));

    await waitFor(() =>
      expect(screen.getAllByText('system error message').length).toBeGreaterThan(0),
    );

    // Expand
    fireEvent.click(screen.getAllByText('system error message')[0]);
    expect(screen.getByText('📋 Copy Log')).toBeTruthy();

    // Collapse
    fireEvent.click(screen.getAllByText('system error message')[0]);
    expect(screen.queryByText('📋 Copy Log')).toBeNull();
  });
});
