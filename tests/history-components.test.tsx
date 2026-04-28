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
      summary: 'summary',
      sentiment: 'positive',
      keywords: ['alpha'],
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
    const onScroll = vi.fn();
    const onSelectHistoryItem = vi.fn();
    const onDeleteHistoryItem = vi.fn();
    const onClearAll = vi.fn();
    const onHistoryPageChange = vi.fn();
    const listContainerRef = React.createRef<HTMLDivElement>();
    const firstEntry = createSidebarEntry('1');

    render(
      <HistorySidebar
        history={[firstEntry, createSidebarEntry('2')]}
        historyPage={2}
        historyTotal={8}
        historyTotalPages={3}
        loading={false}
        searchQuery="initial"
        selectedHistoryId="1"
        listContainerRef={listContainerRef}
        historyListItemHeight={108}
        listTotalHeight={216}
        listOffsetY={0}
        visibleHistoryEntries={[firstEntry]}
        onSearchQueryChange={onSearchQueryChange}
        onSearch={onSearch}
        onScroll={onScroll}
        onSelectHistoryItem={onSelectHistoryItem}
        onDeleteHistoryItem={onDeleteHistoryItem}
        onClearAll={onClearAll}
        onHistoryPageChange={onHistoryPageChange}
        formatDate={() => 'formatted-date'}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'updated' },
    });
    expect(onSearchQueryChange).toHaveBeenCalledWith('updated');

    fireEvent.keyPress(screen.getByPlaceholderText('history.searchPlaceholder'), {
      key: 'Enter',
      charCode: 13,
    });
    expect(onSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('🔍'));
    expect(onSearch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText('🗑️ history.clearAll'));
    expect(onClearAll).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('Entry 1'));
    expect(onSelectHistoryItem).toHaveBeenCalledWith(firstEntry);

    fireEvent.click(screen.getAllByText('🗑️')[0]);
    expect(onDeleteHistoryItem).toHaveBeenCalledWith('1');

    fireEvent.scroll(listContainerRef.current as HTMLDivElement, {
      target: { scrollTop: 64 },
    });
    expect(onScroll).toHaveBeenCalledWith(64);

    fireEvent.click(screen.getByText('← common.previous'));
    const previousUpdater = onHistoryPageChange.mock.calls[0][0] as (current: number) => number;
    expect(previousUpdater(2)).toBe(1);

    fireEvent.click(screen.getByText('common.next →'));
    const nextUpdater = onHistoryPageChange.mock.calls[1][0] as (current: number) => number;
    expect(nextUpdater(2)).toBe(3);

    expect(screen.getByText('count:8')).toBeTruthy();
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
        historyListItemHeight={108}
        listTotalHeight={0}
        listOffsetY={0}
        visibleHistoryEntries={[]}
        onSearchQueryChange={vi.fn()}
        onSearch={vi.fn()}
        onScroll={vi.fn()}
        onSelectHistoryItem={vi.fn()}
        onDeleteHistoryItem={vi.fn()}
        onClearAll={vi.fn()}
        onHistoryPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('⏳ common.loading')).toBeTruthy();

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
        historyListItemHeight={108}
        listTotalHeight={0}
        listOffsetY={0}
        visibleHistoryEntries={[]}
        onSearchQueryChange={vi.fn()}
        onSearch={vi.fn()}
        onScroll={vi.fn()}
        onSelectHistoryItem={vi.fn()}
        onDeleteHistoryItem={vi.fn()}
        onClearAll={vi.fn()}
        onHistoryPageChange={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('history.noHistory')).toBeTruthy();
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
        renderCommentTree={vi.fn()}
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
        renderCommentTree={vi.fn()}
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
        renderCommentTree={vi.fn()}
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
        renderCommentTree={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    fireEvent.click(screen.getByText('💬 history.comments'));
    expect(onViewModeChange).toHaveBeenCalledWith('comments');

    fireEvent.click(screen.getByText('重新分析'));
    expect(onReanalyze).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('history.exportMarkdown'));
    expect(exportUtilsMock.exportAnalysisAsMarkdown).toHaveBeenCalledWith(selectedItem, true);
    expect(screen.getByText('analysis error')).toBeTruthy();
    expect(screen.getByText('Analysis Title')).toBeTruthy();
    expect(screen.getByText(/formatted-date/)).toBeTruthy();
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
        renderCommentTree={vi.fn()}
        formatDate={() => 'formatted-date'}
      />,
    );

    expect(screen.getByText('history.noAnalysis')).toBeTruthy();
    expect(screen.getByText('开始分析')).toBeTruthy();
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
        renderCommentTree={vi.fn()}
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
    const renderCommentTree = vi.fn().mockReturnValue(<div>rendered-tree</div>);

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
        renderCommentTree={renderCommentTree}
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

    expect(renderCommentTree).toHaveBeenCalledWith(selectedItem.comments);
    expect(screen.getByText('rendered-tree')).toBeTruthy();
    expect(screen.getByText('search:12/2')).toBeTruthy();
    expect(screen.getByText('show:11-12/12')).toBeTruthy();
  });
});
