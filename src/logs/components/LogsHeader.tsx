import React from 'react';
import { useTranslation } from 'react-i18next';

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
            placeholder={t('logs.searchPlaceholder', 'Search logs...')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={t('logs.searchAria', 'Search logs')}
          />
        </div>
        <button className="btn-primary" onClick={onRefresh}>
          🔄 {t('logs.refresh', 'Refresh')}
        </button>
        <button className="btn-primary" onClick={onExport}>
          📥 {t('logs.export', 'Export')}
        </button>
        <button className="btn-danger" onClick={onClearAll}>
          🗑️ {t('logs.clearAll', 'Clear All')}
        </button>
      </div>
    </div>
  );
};
