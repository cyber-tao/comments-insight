import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { type HistoryListEntry } from '../hooks/useHistoryData';

interface HistorySidebarProps {
  history: HistoryListEntry[];
  historyPage: number;
  historyTotal: number;
  historyTotalPages: number;
  loading: boolean;
  searchQuery: string;
  selectedHistoryId: string | null;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  historyListItemHeight: number;
  listTotalHeight: number;
  listOffsetY: number;
  visibleHistoryEntries: HistoryListEntry[];
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  onScroll: (scrollTop: number) => void;
  onSelectHistoryItem: (item: HistoryListEntry) => void;
  onDeleteHistoryItem: (id: string) => void;
  onClearAll: () => void;
  onHistoryPageChange: (updater: (current: number) => number) => void;
  formatDate: (timestamp: number) => string;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history,
  historyPage,
  historyTotal,
  historyTotalPages,
  loading,
  searchQuery,
  selectedHistoryId,
  listContainerRef,
  historyListItemHeight,
  listTotalHeight,
  listOffsetY,
  visibleHistoryEntries,
  onSearchQueryChange,
  onSearch,
  onScroll,
  onSelectHistoryItem,
  onDeleteHistoryItem,
  onClearAll,
  onHistoryPageChange,
  formatDate,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="w-1/3 flex flex-col"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRight: '1px solid var(--border-primary)',
      }}
    >
      <div className="p-5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('history.title')}
          </h2>
          {history.length > 0 && (
            <button
              onClick={onClearAll}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors font-medium"
              style={{
                backgroundColor: 'var(--accent-danger)',
                color: 'white',
              }}
            >
              🗑️ {t('history.clearAll')}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && onSearch()}
            placeholder={t('history.searchPlaceholder')}
            className="flex-1 theme-input"
          />
          <button
            onClick={onSearch}
            className="px-4 py-2 rounded-lg text-white font-medium transition-all hover:scale-105"
            style={{ background: 'var(--gradient-primary)' }}
          >
            🔍
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>
            {t('history.commentsWithCount', { count: historyTotal })}
          </span>
          {historyTotalPages > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>
              {historyPage} / {historyTotalPages}
            </span>
          )}
        </div>
      </div>

      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto"
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      >
        {loading ? (
          <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
            <div className="animate-pulse">⏳ {t('common.loading')}</div>
          </div>
        ) : history.length === 0 ? (
          <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
            <p className="text-4xl mb-2">📭</p>
            <p>{t('history.noHistory')}</p>
          </div>
        ) : (
          <div style={{ height: listTotalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${listOffsetY}px)` }}>
              {visibleHistoryEntries.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectHistoryItem(item)}
                  className="p-4 cursor-pointer transition-all"
                  style={{
                    minHeight: historyListItemHeight,
                    backgroundColor:
                      selectedHistoryId === item.id ? 'var(--bg-selected)' : 'transparent',
                    borderBottom: '1px solid var(--border-primary)',
                  }}
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3
                        className="font-semibold truncate mb-1"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {item.title}
                      </h3>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(item.extractedAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteHistoryItem(item.id);
                      }}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      style={{ color: 'var(--accent-danger)' }}
                    >
                      🗑️
                    </button>
                  </div>
                  <div className="flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="flex items-center gap-1">🌐 {item.platform}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {historyTotalPages > 1 && (
        <div
          className="p-3 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--border-primary)' }}
        >
          <button
            onClick={() => onHistoryPageChange((current) => Math.max(1, current - 1))}
            disabled={historyPage <= 1 || loading}
            className="px-3 py-1 rounded text-sm font-medium transition-all disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
            }}
          >
            ← {t('common.previous')}
          </button>
          <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            {historyPage} / {historyTotalPages}
          </span>
          <button
            onClick={() =>
              onHistoryPageChange((current) => Math.min(historyTotalPages, current + 1))
            }
            disabled={historyPage >= historyTotalPages || loading}
            className="px-3 py-1 rounded text-sm font-medium transition-all disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
            }}
          >
            {t('common.next')} →
          </button>
        </div>
      )}
    </div>
  );
};