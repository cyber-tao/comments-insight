/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Popup from '../src/popup/Popup';
import { PATHS } from '../src/config/constants';
import type { Comment } from '../src/types';

const extensionApiMock = vi.hoisted(() => ({
  getHistoryItem: vi.fn(),
  getSettings: vi.fn(),
}));

const i18nMock = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

const usePageInfoMock = vi.hoisted(() => vi.fn());
const useTaskMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

vi.mock('../src/utils/i18n', () => ({
  default: i18nMock,
}));

vi.mock('../src/utils/logger', () => ({
  Logger: loggerMock,
}));

vi.mock('../src/hooks/useTheme', () => ({
  useTheme: vi.fn(),
}));

vi.mock('../src/popup/hooks/usePageInfo', () => ({
  usePageInfo: usePageInfoMock,
}));

vi.mock('../src/popup/hooks/useTask', () => ({
  useTask: useTaskMock,
}));

vi.mock('../src/popup/components/Header', () => ({
  Header: ({
    version,
    aiModelName,
    developerMode,
    onOpenSettings,
    onOpenLogs,
  }: {
    version: string;
    aiModelName: string;
    developerMode: boolean;
    onOpenSettings: () => void;
    onOpenLogs: () => void;
  }) => (
    <div>
      <div>
        header:{version}:{aiModelName}:{developerMode ? 'dev' : 'nodev'}
      </div>
      <button onClick={onOpenSettings}>open-settings</button>
      <button onClick={onOpenLogs}>open-logs</button>
    </div>
  ),
}));

vi.mock('../src/popup/components/PageStatus', () => ({
  PageStatus: ({
    pageInfo,
    pageStatus,
  }: {
    pageInfo: { url: string } | null;
    pageStatus: { extracted: boolean };
  }) => (
    <div>
      status:{pageInfo?.url ?? 'none'}:{pageStatus.extracted ? 'extracted' : 'idle'}
    </div>
  ),
}));

vi.mock('../src/popup/components/ActionButtons', () => ({
  ActionButtons: ({
    onExtract,
    onGenerateConfig,
    onAnalyze,
    onCancel,
    onOpenHistory,
  }: {
    onExtract: () => void;
    onGenerateConfig: () => void;
    onAnalyze: () => void;
    onCancel: (taskId: string) => void;
    onOpenHistory: () => void;
  }) => (
    <div>
      <button onClick={onExtract}>extract</button>
      <button onClick={onGenerateConfig}>config</button>
      <button onClick={onAnalyze}>analyze</button>
      <button onClick={() => onCancel('task-1')}>cancel</button>
      <button onClick={onOpenHistory}>open-history</button>
    </div>
  ),
}));

vi.mock('../src/popup/components/SelectorTester', () => ({
  SelectorTester: () => <div>selector-tester</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.stubGlobal('chrome', {
  runtime: {
    getManifest: vi.fn(),
    getURL: vi.fn(),
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

function createComments(): Comment[] {
  return [
    {
      id: 'comment-1',
      username: 'user',
      content: 'content',
      timestamp: '2025-01-01 12:00',
      likes: 1,
      replies: [],
    },
  ];
}

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(chrome.runtime.getManifest).mockReturnValue({
      version: '1.2.3',
    } as chrome.runtime.Manifest);
    vi.mocked(chrome.runtime.getURL).mockImplementation(
      (path: string) => `chrome-extension://${path}`,
    );
    usePageInfoMock.mockReturnValue({
      loading: false,
      pageInfo: {
        url: 'https://example.com/video',
        title: 'Video Title',
        domain: 'example.com',
      },
      pageStatus: {
        extracted: true,
        analyzed: false,
        historyId: 'history-1',
      },
      loadPageInfo: vi.fn().mockResolvedValue({
        url: 'https://example.com/video',
        title: 'Video Title',
        domain: 'example.com',
      }),
      refreshPageStatus: vi.fn().mockResolvedValue(undefined),
    });
    useTaskMock.mockReturnValue({
      currentTask: null,
      cancelTask: vi.fn().mockResolvedValue(undefined),
      loadCurrentTask: vi.fn().mockResolvedValue(undefined),
      startAnalysis: vi.fn().mockResolvedValue('task-analysis'),
      startConfigGeneration: vi.fn().mockResolvedValue('task-config'),
      startExtraction: vi.fn().mockResolvedValue('task-extract'),
    });
    extensionApiMock.getSettings.mockResolvedValue({
      language: 'en-US',
      developerMode: true,
      aiModel: { model: 'gpt-4o-mini' },
    });
    extensionApiMock.getHistoryItem.mockResolvedValue({
      id: 'history-1',
      comments: createComments(),
    });
  });

  it('shows loading state when page info is still loading', async () => {
    usePageInfoMock.mockReturnValue({
      loading: true,
      pageInfo: null,
      pageStatus: { extracted: false, analyzed: false },
      loadPageInfo: vi.fn(),
      refreshPageStatus: vi.fn(),
    });

    await act(async () => {
      render(<Popup />);
      await Promise.resolve();
    });

    expect(screen.getByText('common.loading')).toBeTruthy();
  });

  it('initializes popup state and renders developer tools when enabled', async () => {
    render(<Popup />);

    await waitFor(() => {
      expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();
      expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en-US');
      expect(screen.getByText('header:1.2.3:gpt-4o-mini:dev')).toBeTruthy();
      expect(screen.getByText('selector-tester')).toBeTruthy();
    });

    const pageInfoHook = usePageInfoMock.mock.results[0]?.value;
    const taskHook = useTaskMock.mock.results[0]?.value;
    expect(pageInfoHook.loadPageInfo).toHaveBeenCalledOnce();
    expect(taskHook.loadCurrentTask).toHaveBeenCalledWith('https://example.com/video');
    expect(screen.getByText('status:https://example.com/video:extracted')).toBeTruthy();
  });

  it('dispatches extract, config, analyze, cancel and open actions', async () => {
    render(<Popup />);

    const taskHook = useTaskMock.mock.results[0]?.value;

    await waitFor(() => {
      expect(extensionApiMock.getSettings).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('extract'));
    expect(taskHook.startExtraction).toHaveBeenCalledWith('https://example.com/video');

    fireEvent.click(screen.getByText('config'));
    expect(taskHook.startConfigGeneration).toHaveBeenCalledWith('https://example.com/video');

    fireEvent.click(screen.getByText('analyze'));
    await waitFor(() => {
      expect(extensionApiMock.getHistoryItem).toHaveBeenCalledWith('history-1');
      expect(taskHook.startAnalysis).toHaveBeenCalledWith('history-1', createComments(), {
        url: 'https://example.com/video',
        platform: 'example.com',
        title: 'Video Title',
      });
    });

    fireEvent.click(screen.getByText('cancel'));
    expect(taskHook.cancelTask).toHaveBeenCalledWith('task-1');

    fireEvent.click(screen.getByText('open-history'));
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://${PATHS.HISTORY_PAGE}`,
    });

    fireEvent.click(screen.getByText('open-settings'));
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://${PATHS.OPTIONS_PAGE}`,
    });

    fireEvent.click(screen.getByText('open-logs'));
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://${PATHS.LOGS_PAGE}`,
    });

    expect(windowCloseMock).toHaveBeenCalledTimes(3);
  });

  it('logs and swallows history lookup failures during analyze', async () => {
    extensionApiMock.getHistoryItem.mockRejectedValue(new Error('history failed'));
    render(<Popup />);

    fireEvent.click(screen.getByText('analyze'));

    await waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith('[Popup] Failed to get history for analysis', {
        error: expect.any(Error),
      });
    });

    const taskHook = useTaskMock.mock.results[0]?.value;
    expect(taskHook.startAnalysis).not.toHaveBeenCalled();
  });
});
