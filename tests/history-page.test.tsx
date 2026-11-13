/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import History from '../src/history/History';
import type { Comment } from '../src/types';

const extensionApiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

const i18nMock = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  t: vi.fn((key: string) => key),
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

const detailPanelMock = vi.hoisted(() => vi.fn());
const useHistoryDataMock = vi.hoisted(() => vi.fn());
const useHistoryReanalyzeMock = vi.hoisted(() => vi.fn());
const useThemeMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn(async () => true));
const useConfirmMock = vi.hoisted(() =>
  vi.fn(() => ({
    confirm: confirmMock,
    ConfirmHost: () => null,
  })),
);

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

vi.mock('../src/utils/i18n', () => ({
  default: i18nMock,
  changeLanguage: i18nMock.changeLanguage,
  loadLocaleResource: vi.fn(async () => undefined),
  t: i18nMock.t ?? ((key: string) => key),
}));

vi.mock('../src/utils/logger', () => ({
  Logger: loggerMock,
}));

vi.mock('../src/history/hooks/useHistoryData', () => ({
  useHistoryData: useHistoryDataMock,
}));

vi.mock('../src/history/hooks/useHistoryReanalyze', () => ({
  useHistoryReanalyze: useHistoryReanalyzeMock,
}));

vi.mock('../src/hooks/useTheme', () => ({
  useTheme: useThemeMock,
}));

vi.mock('../src/hooks/useConfirm', () => ({
  useConfirm: useConfirmMock,
}));

vi.mock('../src/history/components/HistorySidebar', () => ({
  HistorySidebar: ({
    historyTotal,
    onSearch,
    onDeleteHistoryItem,
    onClearAll,
    onSelectHistoryItem,
    onHistoryPageChange,
  }: {
    historyTotal: number;
    onSearch: () => void;
    onDeleteHistoryItem: (id: string) => void;
    onClearAll: () => void;
    onSelectHistoryItem: (item: { id: string }) => void;
    onHistoryPageChange: (value: number) => void;
  }) => (
    <div>
      <div>sidebar-total:{historyTotal}</div>
      <button onClick={onSearch}>sidebar-search</button>
      <button onClick={() => onDeleteHistoryItem('history-1')}>sidebar-delete</button>
      <button onClick={onClearAll}>sidebar-clear</button>
      <button onClick={() => onSelectHistoryItem({ id: 'history-1' })}>sidebar-select</button>
      <button onClick={() => onHistoryPageChange(2)}>sidebar-page</button>
    </div>
  ),
}));

vi.mock('../src/history/components/HistoryDetailPanel', () => ({
  HistoryDetailPanel: (props: {
    paginatedComments: Comment[];
    selectedItemError: string | null;
    totalComments: number;
    totalPages: number;
    onViewModeChange: (value: 'comments' | 'analysis') => void;
    onReanalyze: () => void;
    onCommentSearchTermChange: (value: string) => void;
    onCommentsPerPageChange: (value: number) => void;
    onCurrentPageChange: (value: number) => void;
  }) => {
    detailPanelMock(props);
    const {
      selectedItemError,
      totalComments,
      totalPages,
      onViewModeChange,
      onReanalyze,
      onCommentSearchTermChange,
      onCommentsPerPageChange,
      onCurrentPageChange,
    } = props;
    return (
      <div>
        <div>
          detail:{totalComments}:{totalPages}
        </div>
        <div>detail-error:{selectedItemError ?? 'none'}</div>
        <button onClick={() => onViewModeChange('comments')}>detail-view</button>
        <button onClick={onReanalyze}>detail-reanalyze</button>
        <button onClick={() => onCommentSearchTermChange('needle')}>detail-search</button>
        <button onClick={() => onCommentsPerPageChange(10)}>detail-per-page</button>
        <button onClick={() => onCurrentPageChange(3)}>detail-page</button>
      </div>
    );
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if ((key === 'history.reply' || key === 'history.replies') && options?.count !== undefined) {
        return `replies:${String(options.count)}`;
      }
      return key;
    },
  }),
}));

describe('History page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockImplementation(async () => true);
    useConfirmMock.mockReturnValue({
      confirm: confirmMock,
      ConfirmHost: () => null,
    });
    extensionApiMock.getSettings.mockResolvedValue({
      language: 'ja-JP',
      exportPostContentInMarkdown: true,
    });
    useHistoryDataMock.mockReturnValue({
      fetchHistoryItemById: vi.fn(),
      handleClearAll: vi.fn(),
      handleDelete: vi.fn(),
      handleSearch: vi.fn(),
      handleSelectHistoryItem: vi.fn(),
      history: [{ id: 'history-1' }, { id: 'history-2' }],
      historyPage: 1,
      historyTotal: 2,
      historyTotalPages: 1,
      loading: false,
      searchQuery: '',
      selectedHistoryId: 'history-1',
      selectedItemError: null,
      selectedItem: {
        id: 'history-1',
        comments: [
          {
            id: 'comment-2',
            username: 'zed',
            content: 'match me',
            timestamp: '2026-03-06T09:00:00Z',
            likes: 5,
            replies: [],
          },
        ],
      },
      selectedItemLoading: false,
      setHistoryPage: vi.fn(),
      setSearchQuery: vi.fn(),
      setSelectedItem: vi.fn(),
    });
    useHistoryReanalyzeMock.mockReturnValue({
      handleReanalyze: vi.fn(),
      isReanalyzing: false,
      reanalyzeError: null,
      reanalyzeDetailedProgress: null,
      reanalyzeMessage: null,
      reanalyzeProgress: null,
      reanalyzeTaskId: null,
      reanalyzingHistoryId: null,
    });
  });

  it('loads settings, wires sidebar and detail handlers, and renders comment tree content', async () => {
    render(<History />);

    await waitFor(() => {
      expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();
      expect(i18nMock.changeLanguage).toHaveBeenCalledWith('ja-JP');
      expect(useThemeMock).toHaveBeenCalled();
    });

    const historyData = useHistoryDataMock.mock.results[0]?.value;
    const reanalyze = useHistoryReanalyzeMock.mock.results[0]?.value;
    const firstHistoryDataCall = useHistoryDataMock.mock.calls[0]?.[0];
    const lastHistoryDataCall =
      useHistoryDataMock.mock.calls[useHistoryDataMock.mock.calls.length - 1]?.[0];

    expect(screen.getByText('sidebar-total:2')).toBeTruthy();
    expect(screen.getByText('detail:1:1')).toBeTruthy();
    expect(screen.getByText('detail-error:none')).toBeTruthy();
    expect(screen.getByText('detail:1:1')).toBeTruthy();
    expect(screen.getByText('detail-error:none')).toBeTruthy();

    fireEvent.click(screen.getByText('sidebar-search'));
    expect(historyData.handleSearch).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('sidebar-select'));
    expect(historyData.handleSelectHistoryItem).toHaveBeenCalledWith({ id: 'history-1' });

    fireEvent.click(screen.getByText('sidebar-delete'));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith({
        message: 'history.deleteConfirm',
        destructive: true,
      });
    });
    await waitFor(() => {
      expect(historyData.handleDelete).toHaveBeenCalledWith('history-1', true);
    });

    fireEvent.click(screen.getByText('sidebar-clear'));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith({
        message: 'history.clearAllConfirm',
        destructive: true,
      });
    });
    await waitFor(() => {
      expect(historyData.handleClearAll).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getByText('sidebar-page'));
    expect(historyData.setHistoryPage).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByText('detail-reanalyze'));
    expect(reanalyze.handleReanalyze).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('detail-search'));
    fireEvent.click(screen.getByText('detail-per-page'));
    fireEvent.click(screen.getByText('detail-page'));
    fireEvent.click(screen.getByText('detail-view'));

    expect(firstHistoryDataCall?.onResetListScroll).toBe(lastHistoryDataCall?.onResetListScroll);
    expect(firstHistoryDataCall?.onResetListScroll).toBe(lastHistoryDataCall?.onResetListScroll);
  });

  it.each(['username', 'content', 'timestamp'] as const)(
    'keeps the complete ancestor path when only a grandchild %s matches the search',
    async (field) => {
      const leaf: Comment = {
        id: 'grandchild',
        username: 'Leaf author',
        content: 'Leaf body',
        timestamp: '2026-02-01T00:00:00Z',
        likes: 0,
        replies: [],
      };
      leaf[field] = field === 'timestamp' ? 'needle-time' : 'NEEDLE';
      const sibling: Comment = {
        ...leaf,
        id: 'unmatched-leaf',
        username: 'Other author',
        content: 'Other body',
        timestamp: '2026-02-02T00:00:00Z',
      };
      const child: Comment = {
        ...sibling,
        id: 'child',
        username: 'Child author',
        replies: [leaf, sibling],
      };
      const parent: Comment = {
        ...sibling,
        id: 'parent',
        username: 'Parent author',
        replies: [child, { ...sibling, id: 'other-child' }],
      };
      const historyData = useHistoryDataMock();
      const sourceComments = [parent, { ...sibling, id: 'other-root' }];
      useHistoryDataMock.mockReturnValue({
        ...historyData,
        selectedItem: { ...historyData.selectedItem, comments: sourceComments },
      });
      render(<History />);
      await waitFor(() => expect(extensionApiMock.getSettings).toHaveBeenCalledOnce());

      fireEvent.click(screen.getByText('detail-search'));

      const props = detailPanelMock.mock.lastCall?.[0] as {
        paginatedComments: Comment[];
        totalComments: number;
      };
      expect(props.totalComments).toBe(1);
      expect(props.paginatedComments).toEqual([
        { ...parent, replies: [{ ...child, replies: [leaf] }] },
      ]);
      expect(sourceComments[0].replies).toHaveLength(2);
      expect(sourceComments[0].replies[0].replies).toHaveLength(2);
    },
  );

  it('logs settings load failures without breaking render', async () => {
    extensionApiMock.getSettings.mockRejectedValueOnce(new Error('boom'));

    render(<History />);

    await waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith('[History] Failed to load settings', {
        error: expect.any(Error),
      });
    });

    expect(screen.getByText('sidebar-total:2')).toBeTruthy();
  });
});
