/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionButtons } from '../src/popup/components/ActionButtons';
import { Header } from '../src/popup/components/Header';
import { PageStatus } from '../src/popup/components/PageStatus';
import { SelectorTester } from '../src/popup/components/SelectorTester';
import { TaskProgress } from '../src/popup/components/TaskProgress';
import { LIMITS, MESSAGES, PATHS, STORAGE } from '../src/config/constants';

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
      if (key === 'popup.analysisProgressReceiving') {
        return `localized receiving ${String(options?.characters)} chars`;
      }
      if (key === 'popup.analysisProgressReceivingCompact') {
        return `compact receiving ${String(options?.characters)} chars`;
      }
      if (key === 'notification.analysisFailed') {
        return `Analysis failed: ${String(options?.error)}`;
      }
      if (
        key === 'notification.extractionFailed' ||
        key === 'notification.configGenerationFailed'
      ) {
        return `${key}: ${String(options?.error)}`;
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
        pageStatus={{ extracted: true, analyzed: false, hasConfig: true, historyId: 'history-1' }}
        currentTask={{
          id: 'task-2',
          type: 'analyze',
          status: 'running',
          progress: 40,
          detailedProgress: {
            stage: 'analyzing',
            current: 12,
            total: 100,
            estimatedTimeRemaining: -1,
            stageMessage: 'receiving model response, 2048 chars',
            stageMessageKey: 'popup.analysisProgressReceiving',
            stageMessageParams: { characters: 2048 },
          },
        }}
        onExtract={vi.fn()}
        onGenerateConfig={vi.fn()}
        onAnalyze={onAnalyze}
        onCancel={onCancel}
        onOpenHistory={onOpenHistory}
      />,
    );

    expect(screen.getByText('compact receiving 2048 chars')).toBeTruthy();
    expect(screen.getByTitle('popup.analyzing: localized receiving 2048 chars')).toBeTruthy();
    const progressBar = screen.getByRole('progressbar', { name: 'popup.taskProgress' });
    expect(progressBar.getAttribute('aria-valuenow')).toBe('40');
    expect((progressBar as HTMLElement).style.width).toBe('40%');

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

  it.each([
    ['failed', 'Could not save report', 'Analysis failed: Could not save report'],
    ['unavailable', 'Analysis task not found', 'Analysis task not found'],
  ] as const)('shows %s analysis feedback and allows retry', (status, message, expected) => {
    const onAnalyze = vi.fn();
    render(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: true, analyzed: false, hasConfig: true, historyId: 'history-1' }}
        currentTask={{ id: 'task-1', type: 'analyze', status, progress: 75, message }}
        onExtract={vi.fn()}
        onGenerateConfig={vi.fn()}
        onAnalyze={onAnalyze}
        onCancel={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(expected);
    fireEvent.click(screen.getByRole('button', { name: 'popup.analyzeComments' }));
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it.each(['extract', 'config'] as const)('shows %s failure feedback and enables retry', (type) => {
    const onExtract = vi.fn();
    const onGenerateConfig = vi.fn();
    render(
      <ActionButtons
        pageInfo={{ url: 'https://example.com', title: 'Example', domain: 'example.com' }}
        pageStatus={{ extracted: false, analyzed: false, hasConfig: type === 'extract' }}
        currentTask={{
          id: 'task-1',
          type,
          status: 'failed',
          progress: 0,
          message: 'Visible failure',
        }}
        onExtract={onExtract}
        onGenerateConfig={onGenerateConfig}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Visible failure');
    fireEvent.click(
      screen.getByRole('button', {
        name: type === 'extract' ? 'popup.extractComments' : 'Generate Config',
      }),
    );
    expect(type === 'extract' ? onExtract : onGenerateConfig).toHaveBeenCalledOnce();
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
            stageMessageKey: 'popup.analysisProgressReceiving',
            stageMessageParams: { characters: 128 },
          },
        }}
      />,
    );

    expect(screen.getByText('popup.extracting')).toBeTruthy();
    expect(screen.getByText('popup.progressScrolling: localized receiving 128 chars')).toBeTruthy();
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

  afterEach(() => {
    vi.useRealTimers();
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

describe('Header', () => {
  it('renders version badge, model pill, developer logs toggle, and settings button', () => {
    const onOpenSettings = vi.fn();
    const onOpenLogs = vi.fn();

    const { rerender } = render(
      <Header
        version="0.4.6"
        aiModelName="gpt-4o-mini"
        developerMode={false}
        onOpenSettings={onOpenSettings}
        onOpenLogs={onOpenLogs}
      />,
    );

    expect(screen.getByText('popup.title')).toBeTruthy();
    expect(screen.getByText('popup.version 0.4.6')).toBeTruthy();
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'popup.viewLogs' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'popup.settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    rerender(
      <Header
        version="0.4.6"
        aiModelName="gpt-4o-mini"
        developerMode={true}
        onOpenSettings={onOpenSettings}
        onOpenLogs={onOpenLogs}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'popup.viewLogs' }));
    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });
});

describe('SelectorTester', () => {
  const storageGet = vi.fn();
  const storageSet = vi.fn();
  const storageRemove = vi.fn();
  const sendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storageGet.mockResolvedValue({});
    storageSet.mockResolvedValue(undefined);
    storageRemove.mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: storageGet,
          set: storageSet,
          remove: storageRemove,
        },
      },
      runtime: {
        sendMessage,
      },
    });
  });

  it('hydrates stored state and clears storage when submitted empty', async () => {
    storageGet.mockResolvedValue({
      [STORAGE.SELECTOR_TESTER_STATE_KEY]: {
        selector: '.comment',
        selectorType: 'xpath',
        results: ['Saved item'],
        total: 1,
      },
    });

    render(<SelectorTester />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('.comment')).toBeTruthy();
    });
    expect(screen.getByText('Saved item')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('popup.selectorTesterPlaceholder'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'popup.selectorTesterButton' }));

    await waitFor(() => {
      expect(storageRemove).toHaveBeenCalledWith(STORAGE.SELECTOR_TESTER_STATE_KEY);
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('runs selector test and renders match count, items, truncation notice, and errors', async () => {
    render(<SelectorTester />);

    await waitFor(() => {
      expect(storageGet).toHaveBeenCalledWith(STORAGE.SELECTOR_TESTER_STATE_KEY);
    });

    fireEvent.change(screen.getByPlaceholderText('popup.selectorTesterPlaceholder'), {
      target: { value: '.comment-item' },
    });
    sendMessage.mockResolvedValueOnce({
      success: true,
      total: LIMITS.SELECTOR_TEST_MAX_RESULTS + 2,
      items: ['First match', ''],
    });

    fireEvent.click(screen.getByRole('button', { name: 'popup.selectorTesterButton' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        type: MESSAGES.TEST_SELECTOR,
        payload: { selector: '.comment-item', selectorType: 'css' },
      });
    });

    expect(screen.getByText('First match')).toBeTruthy();
    expect(screen.getByText('popup.selectorTesterEmptyItem')).toBeTruthy();
    expect(screen.getByText('popup.selectorTesterMatches')).toBeTruthy();
    expect(screen.getByText('popup.selectorTesterTruncated')).toBeTruthy();

    sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'Invalid selector syntax',
    });
    fireEvent.click(screen.getByRole('button', { name: 'popup.selectorTesterButton' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid selector syntax')).toBeTruthy();
    });

    sendMessage.mockRejectedValueOnce(new Error('Tab closed'));
    fireEvent.click(screen.getByRole('button', { name: 'popup.selectorTesterButton' }));

    await waitFor(() => {
      expect(screen.getByText('Tab closed')).toBeTruthy();
    });
  });
});
