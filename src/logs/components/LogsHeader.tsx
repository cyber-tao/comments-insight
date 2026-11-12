import React from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, RefreshIcon, TrashIcon } from '@/components/Icons';

interface LogsHeaderProps {
  onRefresh: () => void;
  onExport: () => void;
  onClearAll: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const LogsHeader: React.FC<LogsHeaderProps> = ({
  onRefresh,
  onExport,
  onClearAll,
  searchQuery,
  onSearchChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="logs-header-container">
      <div className="logs-controls">
        <div className="logs-search">
          <input
            type="search"
            className="search-input"
            placeholder={t('logs.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={t('logs.searchAria')}
          />
        </div>
        <button className="btn-secondary" onClick={onRefresh}>
          <RefreshIcon size={14} />
          <span>{t('logs.refresh')}</span>
        </button>
        <button className="btn-primary" onClick={onExport}>
          <DownloadIcon size={14} />
          <span>{t('logs.export')}</span>
        </button>
        <button className="btn-danger" onClick={onClearAll}>
          <TrashIcon size={14} />
          <span>{t('logs.clearAll')}</span>
        </button>
      </div>
    </div>
  );
};
