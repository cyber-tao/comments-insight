/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGINATION } from '../src/config/constants';
import { HistorySidebar } from '../src/history/components/HistorySidebar';
import { HistoryDetailPanel } from '../src/history/components/HistoryDetailPanel';
import type { Comment, HistoryItem } from '../src/types';

const exportUtilsMock = vi.hoisted(() => ({
  exportAnalysisAsMarkdown: vi.fn(),
  exportCommentsAsCSV: vi.fn(),
}));

vi.mock('../src/utils/export', () => exportUtilsMock);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'zh-CN' },
    t: (key: string, options?: Record<string, unknown> | string) => {
      if (typeof options === 'string') {
        return options;
      }
      const translations: Record<string, string> = {
        'popup.analyzing': '正在分析评论',
        'popup.taskProgress': '任务进度',
        'popup.analysisProgressReceiving': 'AI 响应接收中，已收到 {{characters}} 个字符',
        'popup.analysisProgressReceivingCompact': '接收中 · {{characters}} 字符',
      };
      if (translations[key]) {
        return translations[key].replace(/{{(\w+)}}/g, (_, name: string) =>
          String(options?.[name] ?? ''),
        );
      }
      if (key === 'history.commentsWithCount' && options?.count !== undefined) {
        return `count:${String(options.count)}`;
      }
      if (key === 'history.searchResults') {
        return `search:${String(options?.count)}/${String(options?.total)}`;
      }
      if (key === 'history.showingComments') {
        return `show:${String(options?.start)}-${String(options?.end)}/${String(options?.total)}`;
      }
      if ((key === 'history.reply' || key === 'history.replies') && options?.count !== undefined) {
        return `replies:${String(options.count)}`;
      }
      return key;
    },
  }),
}));

function createComment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    username: `user-${id}`,
    content: `content-${id}`,
    timestamp: '2025-01-01 12:00',
    likes: 1,
    replies: [],
    ...overrides,
  };
}

function createHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 'history-1',
    url: 'https://example.com/watch?v=1',
    title: 'History Title',
    platform: 'youtube',
    extractedAt: 1700000000000,
    commentsCount: 2,
    comments: [createComment('1'), createComment('2')],
    postContent: 'Post content',
    analysis: {
      markdown: '# Analysis Title',
      summary: {
        totalComments: 2,
        sentimentDistribution: { positive: 1, neutral: 1, negative: 0 },
        hotComments: [],
        keyInsights: ['alpha'],
      },
      tokensUsed: 10,
      generatedAt: 1700000000000,
    },
    ...overrides,
  };
}

function createSidebarEntry(id: string) {
  return {
    id,
    extractedAt: 1700000000000,
    url: `https://example.com/${id}`,
    title: `Entry ${id}`,
    platform: 'youtube',
  };
}

describe('HistorySidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards search, selection, delete, clear and paging actions', () => {
    const onSearchQueryChange = vi.fn();
    const onSearch = vi.fn();
    const onSelectHistoryItem = vi.fn();
    const onDeleteHistoryItem = vi.fn();
    const onClearAll = vi.fn();
    const onHistoryPageChange = vi.fn();
    const listContainerRef = React.createRef<HTMLDivElement>();
    const entries = Array.from({ length: PAGINATION.DEFAULT_PER_PAGE }, (_, index) =>
      createSidebarEntry(String(index + 1)),
    );

    render(
      <HistorySidebar
        history={entries}
        historyPage={2}
        historyTotal={47}
        historyTotalPages={3}
        loading={false}
        searchQuery="initial"
        selectedHistoryId="1"
        listContainerRef={listContainerRef}
        onSearchQueryChange={onSearchQueryChange}
        onSearch={onSearch}
        onSelectHistoryItem={onSelectHistoryItem}
        onDeleteHistoryItem={onDeleteHistoryItem}
        onClearAll={onClearAll}
        onHistoryPageChange={onHistoryPageChange}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(listContainerRef.current?.querySelectorAll('h3')).toHaveLength(entries.length);

    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'updated' },
    });
    expect(onSearchQueryChange).toHaveBeenCalledWith('updated');

    fireEvent.keyPress(screen.getByPlaceholderText('history.searchPlaceholder'), {
      key: 'Enter',
      charCode: 13,
    });
    expect(onSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'history.searchAria' }));
    expect(onSearch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText('history.clearAll'));
    expect(onClearAll).toHaveBeenCalledOnce();

    const selection = screen.getByRole('button', { name: /Entry 1 formatted-date youtube/ });
    expect(selection.tagName).toBe('BUTTON');
    expect(selection.tabIndex).toBe(0);
    expect(selection.getAttribute('aria-pressed')).toBe('true');
    selection.focus();
    expect(document.activeElement).toBe(selection);
    fireEvent.click(selection);
    expect(onSelectHistoryItem).toHaveBeenCalledWith(entries[0]);

    fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' })[0]);
    expect(onDeleteHistoryItem).toHaveBeenCalledWith('1');
    expect(onSelectHistoryItem).toHaveBeenCalledOnce();
    expect(selection.querySelector('button')).toBeNull();

    fireEvent.click(screen.getByText('← common.previous'));
    const previousUpdater = onHistoryPageChange.mock.calls[0][0] as (current: number) => number;
    expect(previousUpdater(2)).toBe(1);

    fireEvent.click(screen.getByText('common.next →'));
    const nextUpdater = onHistoryPageChange.mock.calls[1][0] as (current: number) => number;
    expect(nextUpdater(2)).toBe(3);

    expect(screen.getByText('count:47')).toBeTruthy();
    expect(screen.getAllByText('2 / 3')).toHaveLength(2);
  });

  it('renders loading and empty states', () => {
    const listContainerRef = React.createRef<HTMLDivElement>();

    const { rerender } = render(
      <HistorySidebar
        history={[]}
        historyPage={1}
        historyTotal={0}
        historyTotalPages={0}
        loading={true}
        searchQuery=""
        selectedHistoryId={null}
        listContainerRef={listContainerRef}
        onSearchQueryChange={vi.fn()}
        onSearch={vi.fn()}
        onSelectHistoryItem={vi.fn()}
        onDeleteHistoryItem={vi.fn()}
        onClearAll={vi.fn()}
        onHistoryPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('common.loading')).toBeTruthy();

    rerender(
      <HistorySidebar
        history={[]}
        historyPage={1}
        historyTotal={0}
        historyTotalPages={0}
        loading={false}
        searchQuery=""
        selectedHistoryId={null}
        listContainerRef={listContainerRef}
        onSearchQueryChange={vi.fn()}
        onSearch={vi.fn()}
        onSelectHistoryItem={vi.fn()}
        onDeleteHistoryItem={vi.fn()}
        onClearAll={vi.fn()}
        onHistoryPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('history.noHistory')).toBeTruthy();
  });

  it('distinguishes load failure from empty history and exposes retry actions', () => {
    const onRetryLoad = vi.fn();
    const onRetryOperation = vi.fn();
    render(
      <HistorySidebar
        history={[]}
        historyPage={1}
        historyTotal={0}
        historyTotalPages={0}
        loading={false}
        loadError
        operationError="delete"
        onRetryLoad={onRetryLoad}
        onRetryOperation={onRetryOperation}
        searchQuery=""
        selectedHistoryId={null}
        listContainerRef={{ current: null }}
        onSearchQueryChange={vi.fn()}
        onSearch={vi.fn()}
        onSelectHistoryItem={vi.fn()}
        onDeleteHistoryItem={vi.fn()}
        onClearAll={vi.fn()}
        onHistoryPageChange={vi.fn()}
        formatDate={() => 'date'}
      />,
    );
    expect(screen.queryByText('history.noHistory')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('history.loadFailed');
    expect(screen.getByRole('alert').textContent).toContain('history.deleteFailed');
    fireEvent.click(screen.getByRole('button', { name: 'history.retryLoad' }));
    fireEvent.click(screen.getByRole('button', { name: 'history.retryOperation' }));
    expect(onRetryLoad).toHaveBeenCalledOnce();
    expect(onRetryOperation).toHaveBeenCalledOnce();
  });

  it('keeps old rows visible but disables mutations while loading a new list', () => {
    const onDeleteHistoryItem = vi.fn();
    const onClearAll = vi.fn();
    const onRetryOperation = vi.fn();
    render(
      <HistorySidebar
        history={[createSidebarEntry('old')]}
        historyPage={1}
        historyTotal={1}
        historyTotalPages={1}
        loading
        operationError="clear"
        onRetryOperation={onRetryOperation}
        searchQuery="new"
        selectedHistoryId={null}
        listContainerRef={{ current: null }}
        onSearchQueryChange={vi.fn()}
        onSearch={vi.fn()}
        onSelectHistoryItem={vi.fn()}
        onDeleteHistoryItem={onDeleteHistoryItem}
        onClearAll={onClearAll}
        onHistoryPageChange={vi.fn()}
        formatDate={() => 'date'}
      />,
    );
    expect(screen.getByText('Entry old')).toBeTruthy();
    for (const name of ['common.delete', 'history.clearAll', 'history.retryOperation']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onDeleteHistoryItem).not.toHaveBeenCalled();
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onRetryOperation).not.toHaveBeenCalled();
  });
});

describe('HistoryDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading and empty states when no item is selected', () => {
    const { rerender } = render(
      <HistoryDetailPanel
        selectedItem={null}
        selectedItemError={null}
        selectedItemLoading={true}
        viewMode="analysis"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={0}
        totalPages={0}
        paginatedComments={[]}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('common.loading')).toBeTruthy();

    rerender(
      <HistoryDetailPanel
        selectedItem={null}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="analysis"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={0}
        totalPages={0}
        paginatedComments={[]}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('history.selectItem')).toBeTruthy();

    rerender(
      <HistoryDetailPanel
        selectedItem={null}
        selectedItemError="Failed to load history item"
        selectedItemLoading={false}
        viewMode="analysis"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={0}
        totalPages={0}
        paginatedComments={[]}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('Failed to load history item')).toBeTruthy();
  });

  it('handles analysis tab actions and markdown export', () => {
    const onViewModeChange = vi.fn();
    const onReanalyze = vi.fn();
    const selectedItem = createHistoryItem();

    render(
      <HistoryDetailPanel
        selectedItem={selectedItem}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="analysis"
        exportPostContentInMarkdown={true}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={selectedItem.comments.length}
        totalPages={1}
        paginatedComments={selectedItem.comments}
        isReanalyzing={false}
        reanalyzeError={'analysis error'}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={selectedItem.id}
        onViewModeChange={onViewModeChange}
        onReanalyze={onReanalyze}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    fireEvent.click(screen.getByText('history.comments'));
    expect(onViewModeChange).toHaveBeenCalledWith('comments');

    fireEvent.click(screen.getByText('history.reanalyze'));
    expect(onReanalyze).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('history.exportMarkdown'));
    expect(exportUtilsMock.exportAnalysisAsMarkdown).toHaveBeenCalledWith(selectedItem, true);
    expect(screen.getByText('analysis error')).toBeTruthy();
    expect(screen.getByText('Analysis Title')).toBeTruthy();
    expect(screen.getByText(/formatted-date/)).toBeTruthy();
  });

  it('renders model image alt text without loading resources or executing raw HTML', () => {
    const selectedItem = createHistoryItem({
      analysis: {
        markdown: [
          '# Privacy report',
          '![Remote chart](https://audit.invalid/pixel?data=SYNTHETIC)',
          '![Local chart](data:image/png;base64,AA==)',
          '[Explicit link](https://audit.invalid/manual)',
          '[Unsafe link](javascript:alert%281%29)',
          '<img id="raw-image" src="https://audit.invalid/raw" onerror="alert(1)">',
          '<script id="raw-script">alert(1)</script>',
        ].join('\n\n'),
        tokensUsed: 1,
        generatedAt: 1700000000000,
      },
    });
    const { container } = render(
      <HistoryDetailPanel
        selectedItem={selectedItem}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="analysis"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={selectedItem.comments.length}
        totalPages={1}
        paginatedComments={selectedItem.comments}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('Privacy report')).toBeTruthy();
    expect(screen.getByText('Remote chart')).toBeTruthy();
    expect(screen.getByText('Local chart')).toBeTruthy();
    expect(container.querySelector('img, script, #raw-image, #raw-script')).toBeNull();
    expect(screen.getByRole('link', { name: 'Explicit link' }).getAttribute('href')).toBe(
      'https://audit.invalid/manual',
    );
    expect(screen.getByText('Unsafe link').getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('treats blank analysis markdown as no analysis result', () => {
    const selectedItem = createHistoryItem({
      analysis: {
        ...(createHistoryItem().analysis as NonNullable<HistoryItem['analysis']>),
        markdown: '   ',
      },
    });

    render(
      <HistoryDetailPanel
        selectedItem={selectedItem}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="analysis"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={selectedItem.comments.length}
        totalPages={1}
        paginatedComments={selectedItem.comments}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('history.noAnalysis')).toBeTruthy();
    expect(screen.getByText('history.startAnalysis')).toBeTruthy();
    expect(screen.queryByText('history.exportMarkdown')).toBeNull();
  });

  it('renders streaming progress on the analysis action button', () => {
    const selectedItem = createHistoryItem();

    render(
      <HistoryDetailPanel
        selectedItem={selectedItem}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="analysis"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.DEFAULT_PER_PAGE}
        currentPage={1}
        totalComments={selectedItem.comments.length}
        totalPages={1}
        paginatedComments={selectedItem.comments}
        isReanalyzing={true}
        reanalyzeError={null}
        reanalyzeDetailedProgress={{
          stage: 'analyzing',
          current: 42,
          total: 100,
          estimatedTimeRemaining: -1,
          stageMessageKey: 'popup.analysisProgressReceiving',
          stageMessageParams: { characters: 2048 },
        }}
        reanalyzeMessage={null}
        reanalyzeProgress={42}
        reanalyzeTaskId="task-1"
        reanalyzingHistoryId={selectedItem.id}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('接收中 · 2048 字符')).toBeTruthy();

    const button = screen.getByRole('button', { name: /接收中 · 2048 字符/ });
    expect(button.getAttribute('title')).toBe(
      '正在分析评论: AI 响应接收中，已收到 2048 个字符 #task-1',
    );

    const progressbar = screen.getByRole('progressbar', { name: '任务进度' });
    expect(progressbar.getAttribute('aria-valuenow')).toBe('42');
    expect((progressbar.firstElementChild as HTMLElement).style.width).toBe('42%');
  });

  it('handles comments tab actions, paging and csv export', () => {
    const selectedItem = createHistoryItem({ analysis: undefined });
    const onCommentSearchTermChange = vi.fn();
    const onSortByChange = vi.fn();
    const onCommentsPerPageChange = vi.fn();
    const onCurrentPageChange = vi.fn();

    render(
      <HistoryDetailPanel
        selectedItem={selectedItem}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="comments"
        exportPostContentInMarkdown={false}
        commentSearchTerm="term"
        sortBy="likes"
        commentsPerPage={PAGINATION.OPTIONS[0]}
        currentPage={2}
        totalComments={12}
        totalPages={3}
        paginatedComments={selectedItem.comments}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={onCommentSearchTermChange}
        onSortByChange={onSortByChange}
        onCommentsPerPageChange={onCommentsPerPageChange}
        onCurrentPageChange={onCurrentPageChange}
        formatDate={() => 'formatted-date'}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('history.searchComments'), {
      target: { value: 'updated-term' },
    });
    expect(onCommentSearchTermChange).toHaveBeenCalledWith('updated-term');

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'time' } });
    expect(onSortByChange).toHaveBeenCalledWith('time');

    fireEvent.change(selects[1], {
      target: { value: String(PAGINATION.OPTIONS[1]) },
    });
    expect(onCommentsPerPageChange).toHaveBeenCalledWith(PAGINATION.OPTIONS[1]);

    fireEvent.click(screen.getByText('history.exportCsv'));
    expect(exportUtilsMock.exportCommentsAsCSV).toHaveBeenCalledWith(
      selectedItem.comments,
      selectedItem.title,
    );

    fireEvent.click(screen.getAllByText('← common.previous')[0]);
    const previousUpdater = onCurrentPageChange.mock.calls[0][0] as (current: number) => number;
    expect(previousUpdater(2)).toBe(1);

    fireEvent.click(screen.getAllByText('common.next →')[0]);
    const nextUpdater = onCurrentPageChange.mock.calls[1][0] as (current: number) => number;
    expect(nextUpdater(2)).toBe(3);

    expect(screen.getByText('user-1')).toBeTruthy();
    expect(screen.getByText('search:12/2')).toBeTruthy();
    expect(screen.getByText('show:11-12/12')).toBeTruthy();
  });

  it('renders DynamicReportViewer using sandbox iframe and handles postMessage', () => {
    const selectedItem = createHistoryItem({
      analysis: {
        markdown: '# Analysis',
        dynamicHtml: '<html><body><h1>Dashboard</h1></body></html>',
        tokensUsed: 100,
        generatedAt: 123,
        summary: {
          totalComments: 1,
          sentimentDistribution: { positive: 100, negative: 0, neutral: 0 },
          hotComments: [],
          keyInsights: [],
        },
      },
    });

    const detail = (
      <HistoryDetailPanel
        selectedItem={selectedItem}
        selectedItemError={null}
        selectedItemLoading={false}
        viewMode="dynamic"
        exportPostContentInMarkdown={false}
        commentSearchTerm=""
        sortBy="likes"
        commentsPerPage={PAGINATION.OPTIONS[0]}
        currentPage={1}
        totalComments={1}
        totalPages={1}
        paginatedComments={selectedItem.comments}
        isReanalyzing={false}
        reanalyzeError={null}
        reanalyzeProgress={null}
        reanalyzeTaskId={null}
        reanalyzingHistoryId={null}
        generateDynamicError="Could not regenerate the dynamic report"
        onViewModeChange={vi.fn()}
        onReanalyze={vi.fn()}
        onCommentSearchTermChange={vi.fn()}
        onSortByChange={vi.fn()}
        onCommentsPerPageChange={vi.fn()}
        onCurrentPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />
    );
    const { rerender } = render(detail);

    expect(screen.getByRole('alert').textContent).toBe('Could not regenerate the dynamic report');
    const iframe = screen.getByTitle('History Title') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toContain('src/sandbox/index.html');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');

    const iframeWindow = iframe.contentWindow;
    expect(iframeWindow).not.toBeNull();
    const postMessage = vi.spyOn(iframeWindow!, 'postMessage').mockImplementation(() => undefined);

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'SANDBOX_READY' },
        source: window,
      }),
    );
    expect(postMessage).not.toHaveBeenCalled();

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'SANDBOX_READY' },
        source: iframeWindow,
      }),
    );
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'RENDER_REPORT',
        html: selectedItem.analysis?.dynamicHtml,
        locale: 'zh-CN',
        errorTitle: 'history.reportRenderFailed',
        errorMessage: 'history.reportRenderRecovery',
      },
      '*',
    );

    const previousUrl = window.location.href;
    try {
      window.history.replaceState({}, '', '?tab=dynamic&fullscreen=true');
      rerender(React.cloneElement(detail));
      expect(screen.getByRole('alert').textContent).toBe('Could not regenerate the dynamic report');
      expect(screen.getByText('history.backToHistory')).toBeTruthy();
    } finally {
      window.history.replaceState({}, '', previousUrl);
    }
  });
});
