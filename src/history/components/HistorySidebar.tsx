import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { BrandIcon, GlobeIcon, HistoryIcon, SearchIcon, TrashIcon } from '@/components/Icons';
import { type HistoryListEntry } from '../hooks/useHistoryData';

interface HistorySidebarProps {
  history: HistoryListEntry[];
  historyPage: number;
  historyTotal: number;
  historyTotalPages: number;
  loading: boolean;
  loadError?: boolean;
  operationError?: 'delete' | 'clear' | null;
  operationPending?: boolean;
  onRetryLoad?: () => void;
  onRetryOperation?: () => void;
  searchQuery: string;
  selectedHistoryId: string | null;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
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
  loadError = false,
  operationError = null,
  operationPending = false,
  onRetryLoad,
  onRetryOperation,
  searchQuery,
  selectedHistoryId,
  listContainerRef,
  onSearchQueryChange,
  onSearch,
  onSelectHistoryItem,
  onDeleteHistoryItem,
  onClearAll,
  onHistoryPageChange,
  formatDate,
}) => {
  const { t } = useTranslation();

  const renderItem = (item: HistoryListEntry): React.ReactElement => {
    const isSelected = selectedHistoryId === item.id;
    return (
      <div
        key={item.id}
        className="group relative flex items-start transition-colors hover:bg-[var(--bg-hover)]"
        style={{
          backgroundColor: isSelected ? 'var(--bg-selected)' : undefined,
          borderBottom: '1px solid var(--border-primary)',
          borderLeft: isSelected ? '3px solid var(--accent-primary)' : '3px solid transparent',
        }}
      >
        <button
          type="button"
          onClick={() => onSelectHistoryItem(item)}
          aria-pressed={isSelected}
          className="min-w-0 flex-1 px-5 py-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
        >
          <div className="min-w-0 mb-1.5">
            <h3
              className="text-sm font-semibold truncate mb-1 leading-snug"
              style={{ color: 'var(--text-primary)' }}
            >
              {item.title}
            </h3>
            <p className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {formatDate(item.extractedAt)}
            </p>
          </div>
          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono-code text-[11px]"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
              }}
            >
              <GlobeIcon size={11} />
              {item.platform}
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onDeleteHistoryItem(item.id)}
          disabled={loading || operationPending}
          className="mr-3 mt-3.5 p-1.5 rounded-md opacity-75 group-hover:opacity-100 hover:bg-[var(--accent-danger-soft)] transition-all disabled:opacity-50"
          style={{ color: 'var(--accent-danger)' }}
          aria-label={t('common.delete')}
          title={t('common.delete')}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    );
  };

  return (
    <div
      className="w-72 lg:w-80 shrink-0 flex flex-col"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRight: '1px solid var(--border-primary)',
      }}
    >
      <div className="p-5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandIcon size={32} />
            <h2
              className="text-xl font-bold tracking-tight truncate font-serif-editorial"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('history.title')}
            </h2>
          </div>
          {history.length > 0 && (
            <button
              onClick={onClearAll}
              disabled={loading || operationPending}
              className="theme-button-danger px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 shrink-0"
            >
              <TrashIcon size={13} />
              <span>{t('history.clearAll')}</span>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            disabled={operationPending}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && onSearch()}
            placeholder={t('history.searchPlaceholder')}
            className="flex-1 text-sm theme-input"
            aria-label={t('history.searchAria')}
          />
          <button
            onClick={onSearch}
            disabled={operationPending}
            className="theme-button-primary px-3.5 py-2 inline-flex items-center justify-center"
            aria-label={t('history.searchAria')}
            title={t('history.searchAria')}
          >
            <SearchIcon size={16} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs tabular-nums">
          <span style={{ color: 'var(--text-muted)' }}>
            {t('history.commentsWithCount', { count: historyTotal })}
          </span>
          {historyTotalPages > 0 && (
            <span className="font-mono-code" style={{ color: 'var(--text-muted)' }}>
              {historyPage} / {historyTotalPages}
            </span>
          )}
        </div>
      </div>

      {(loadError || operationError) && (
        <div role="alert" className="px-5 py-3 text-sm" style={{ color: 'var(--accent-danger)' }}>
          {loadError && (
            <div>
              <p>{t('history.loadFailed')}</p>
              <button
                type="button"
                onClick={onRetryLoad}
                disabled={loading || operationPending}
                className="theme-button-secondary mt-2 px-3 py-1 text-xs"
              >
                {t('history.retryLoad')}
              </button>
            </div>
          )}
          {operationError && (
            <div>
              <p>
                {t(operationError === 'delete' ? 'history.deleteFailed' : 'history.clearFailed')}
              </p>
              <button
                type="button"
                onClick={onRetryOperation}
                disabled={loading || operationPending}
                className="theme-button-secondary mt-2 px-3 py-1 text-xs"
              >
                {t('history.retryOperation')}
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={listContainerRef}
        aria-busy={loading || operationPending}
        className="flex-1 overflow-y-auto"
      >
        {loading && history.length === 0 ? (
          <div
            className="p-8 flex flex-col items-center justify-center gap-2.5 text-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }}
            />
            <div className="text-sm">{t('common.loading')}</div>
          </div>
        ) : history.length === 0 && !loadError ? (
          <div
            className="p-10 flex flex-col items-center justify-center text-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <div
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
            >
              <HistoryIcon size={22} />
            </div>
            <p className="text-sm">{t('history.noHistory')}</p>
          </div>
        ) : (
          history.map(renderItem)
        )}
      </div>

      {historyTotalPages > 1 && (
        <div
          className="p-3 flex items-center justify-between"
          style={{
            borderTop: '1px solid var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)',
          }}
        >
          <button
            onClick={() => onHistoryPageChange((current) => Math.max(1, current - 1))}
            disabled={historyPage <= 1 || loading || operationPending}
            className="theme-button-secondary px-3 py-1 text-xs disabled:opacity-50"
          >
            ← {t('common.previous')}
          </button>
          <span
            className="text-xs font-mono-code font-medium tabular-nums"
            style={{ color: 'var(--text-muted)' }}
          >
            {historyPage} / {historyTotalPages}
          </span>
          <button
            onClick={() =>
              onHistoryPageChange((current) => Math.min(historyTotalPages, current + 1))
            }
            disabled={historyPage >= historyTotalPages || loading || operationPending}
            className="theme-button-secondary px-3 py-1 text-xs disabled:opacity-50"
          >
            {t('common.next')} →
          </button>
        </div>
      )}
    </div>
  );
};
