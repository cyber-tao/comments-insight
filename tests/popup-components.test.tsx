/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionButtons } from '../src/popup/components/ActionButtons';
import { TaskProgress } from '../src/popup/components/TaskProgress';
import { PageStatus } from '../src/popup/components/PageStatus';
import { PATHS } from '../src/config/constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      if (typeof options === 'string') {
        return options;
      }
      if (key === 'popup.timeRemainingSeconds') {
        return `${String(options?.seconds)}s`;
      }
      if (key === 'popup.timeRemainingMinutes') {
        return `${String(options?.minutes)}m`;
      }
      if (key === 'popup.timeRemainingMinutesSeconds') {
        return `${String(options?.minutes)}m ${String(options?.seconds)}s`;
      }
      return key;
    },
  }),
}));

vi.stubGlobal('chrome', {
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://${path}`),
  },
  tabs: {
    create: vi.fn(),
  },
});

const windowCloseMock = vi.fn();
Object.defineProperty(window, 'close', {
  configurable: true,
  value: windowCloseMock,
});

describe('ActionButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes extract flow based on page status and opens history when already extracted', () => {
    const onExtract = vi.fn();
    const onGenerateConfig = vi.fn();

    const { rerender } = render(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: false, analyzed: false, hasConfig: false }}
        currentTask={null}
        onExtract={onExtract}
        onGenerateConfig={onGenerateConfig}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Generate Config'));
    expect(onGenerateConfig).toHaveBeenCalledOnce();

    rerender(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: false, analyzed: false, hasConfig: true }}
        currentTask={null}
        onExtract={onExtract}
        onGenerateConfig={onGenerateConfig}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('popup.extractComments'));
    expect(onExtract).toHaveBeenCalledOnce();

    rerender(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: true, analyzed: false, hasConfig: true, historyId: 'history-1' }}
        currentTask={null}
        onExtract={onExtract}
        onGenerateConfig={onGenerateConfig}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('popup.viewComments'));
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://${PATHS.HISTORY_PAGE}?id=history-1&tab=comments`,
    });
    expect(windowCloseMock).toHaveBeenCalledOnce();
  });

  it('handles analyze flow, active task progress, cancel, and history action', () => {
    const onAnalyze = vi.fn();
    const onCancel = vi.fn();
    const onOpenHistory = vi.fn();

    const { rerender } = render(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: true, analyzed: false, hasConfig: true, historyId: 'history-1' }}
        currentTask={null}
        onExtract={vi.fn()}
        onGenerateConfig={vi.fn()}
        onAnalyze={onAnalyze}
        onCancel={onCancel}
        onOpenHistory={onOpenHistory}
      />,
    );

    fireEvent.click(screen.getByText('popup.analyzeComments'));
    expect(onAnalyze).toHaveBeenCalledOnce();

    rerender(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: true, analyzed: false, hasConfig: true, historyId: 'history-1' }}
        currentTask={{
          id: 'task-1',
          type: 'extract',
          status: 'running',
          progress: 32,
          message: 'extracting:12:40',
        }}
        onExtract={vi.fn()}
        onGenerateConfig={vi.fn()}
        onAnalyze={onAnalyze}
        onCancel={onCancel}
        onOpenHistory={onOpenHistory}
      />,
    );

    expect(screen.getByText('popup.progressExtracting 12/40')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(onCancel).toHaveBeenCalledWith('task-1');

    fireEvent.click(screen.getByText('popup.viewHistory'));
    expect(onOpenHistory).toHaveBeenCalledOnce();

    rerender(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: true, analyzed: true, hasConfig: true, historyId: 'history-1' }}
        currentTask={null}
        onExtract={vi.fn()}
        onGenerateConfig={vi.fn()}
        onAnalyze={onAnalyze}
        onCancel={onCancel}
        onOpenHistory={onOpenHistory}
      />,
    );

    fireEvent.click(screen.getByText('popup.viewAnalysis'));
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://${PATHS.HISTORY_PAGE}?id=history-1&tab=analysis`,
    });
  });
});

describe('TaskProgress', () => {
  it('renders detailed progress, estimated time, and fallback parsing', () => {
    const { rerender } = render(
      <TaskProgress
        task={{
          id: 'task-1',
          type: 'extract',
          status: 'running',
          progress: 45,
          detailedProgress: {
            stage: 'scrolling',
            current: 4,
            total: 10,
            estimatedTimeRemaining: 75,
            stageMessage: 'deep scan',
          },
        }}
      />,
    );

    expect(screen.getByText('popup.extracting')).toBeTruthy();
    expect(screen.getByText('popup.progressScrolling: deep scan')).toBeTruthy();
    expect(screen.getByText('popup.estimatedTime: 1m 15s')).toBeTruthy();

    rerender(
      <TaskProgress
        task={{
          id: 'task-2',
          type: 'config',
          status: 'pending',
          progress: 0,
          message: 'analyzing:3:9',
        }}
      />,
    );

    expect(screen.getByText('popup.progressAnalyzing 3/9')).toBeTruthy();

    rerender(
      <TaskProgress
        task={{
          id: 'task-3',
          type: 'analyze',
          status: 'completed',
          progress: 100,
        }}
      />,
    );

    expect(screen.queryByText('popup.analyzing')).toBeNull();
  });
});

describe('PageStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T12:00:00Z'));
  });

  it('renders invalid page and extracted or analyzed metadata', () => {
    const { rerender } = render(
      <PageStatus
        pageInfo={null}
        pageStatus={{ extracted: false, analyzed: false, hasConfig: false }}
      />,
    );

    expect(screen.getByText('popup.invalidPage')).toBeTruthy();

    rerender(
      <PageStatus
        pageInfo={{ url: 'https://example.com', title: 'Example Title', domain: 'example.com' }}
        pageStatus={{
          extracted: true,
          analyzed: true,
          hasConfig: true,
          commentsCount: 42,
          extractedAt: new Date('2026-03-06T11:58:00Z').getTime(),
          analyzedAt: new Date('2026-03-06T10:00:00Z').getTime(),
        }}
      />,
    );

    expect(screen.getByText('Example Title')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByText('popup.analyzed')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('2popup.minutesAgo')).toBeTruthy();
    expect(screen.getByText('2popup.hoursAgo')).toBeTruthy();
  });
});
