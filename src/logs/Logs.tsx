import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useConfirm } from '@/hooks/useConfirm';
import { Logger, LogLevel } from '@/utils/logger';
import { changeLanguage } from '@/utils/i18n';
import { ExtensionAPI } from '@/utils/extension-api';
import { LOG_LEVEL_LABELS, LOG_LEVELS } from '@/config/constants';

import { useLogs } from './hooks/useLogs';
import { LogsHeader } from './components/LogsHeader';
import { AiLogItem } from './components/AiLogItem';
import { SystemLogItem } from './components/SystemLogItem';

import '@/styles/global.css';
import './logs.css';

type Tab = 'ai' | 'system';

export default function Logs() {
  const { t } = useTranslation();
  useTheme(); // Applies theme automatically
  const { confirm, ConfirmHost } = useConfirm();

  const {
    loading,
    aiLogs,
    systemLogs,
    systemStats,
    searchQuery,
    setSearchQuery,
    levelFilter,
    setLevelFilter,
    loadLogs,
    clearAllLogs,
    deleteLog,
  } = useLogs();

  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [operationError, setOperationError] = useState<string | null>(null);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await ExtensionAPI.getSettings();
        if (settings?.language) {
          await changeLanguage(settings.language);
        }
      } catch (error) {
        Logger.error('[Logs] Failed to load settings', { error });
      }
    };

    void loadSettings();
  }, []);

  const handleClearAll = async () => {
    const confirmed = await confirm({
      message: t('logs.confirmClearLogs'),
      destructive: true,
    });
    if (!confirmed) return;
    setOperationError(null);
    try {
      await clearAllLogs();
    } catch {
      // The hook retains the loaded rows and records the sanitized diagnostic.
      setOperationError(t('errors.storageWriteError'));
    }
  };

  const handleExport = async () => {
    try {
      const targetLogs = activeTab === 'ai' ? aiLogs : systemLogs;
      const data = JSON.stringify(targetLogs, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeTab}-logs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      Logger.error('[Logs] Failed to export', { error });
    }
  };

  const handleDeleteLog = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirm({
      message: t('logs.confirmDeleteLog'),
      destructive: true,
    });
    if (!confirmed) return;
    setOperationError(null);
    try {
      await deleteLog(key, activeTab);
    } catch {
      setOperationError(t('errors.storageWriteError'));
    }
  };

  return (
    <div className="logs-container">
      <div className="logs-header-section">
        <div className="logs-tabs">
          <button
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            {t('logs.filterAI')} ({aiLogs.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            {t('logs.filterSystem')} ({systemLogs.length})
          </button>
        </div>

        <LogsHeader
          onRefresh={loadLogs}
          onExport={handleExport}
          onClearAll={handleClearAll}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      {activeTab === 'system' && (
        <div className="logs-filters">
          <label className="level-filter-label">
            <span>{t('logs.level')}</span>
            <select
              name="levelFilter"
              aria-label={t('logs.level')}
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as 'all' | LogLevel)}
              className="select-input"
            >
              <option value="all">{t('logs.levelAll')}</option>
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(LOG_LEVEL_LABELS[level])}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {activeTab === 'system' && (
        <div className="logs-stats-bar">
          <span>{t('logs.totalCount', { count: systemStats.total })}</span>
          <span>{t('logs.errorCount', { count: systemStats.errors })}</span>
          <span>{t('logs.debugCount', { count: systemStats.debugs })}</span>
          <span>{t('logs.infoCount', { count: systemStats.infos })}</span>
          <span>{t('logs.warningCount', { count: systemStats.warns })}</span>
        </div>
      )}

      {operationError && (
        <div role="alert" style={{ color: 'var(--accent-danger)', padding: '0.75rem 1rem' }}>
          {operationError}
        </div>
      )}

      <div className="log-list">
        {loading ? (
          <div className="empty-state">{t('logs.loading')}</div>
        ) : activeTab === 'ai' ? (
          aiLogs.length === 0 ? (
            <div className="empty-state">{t('logs.empty')}</div>
          ) : (
            aiLogs.map((log) => <AiLogItem key={log.key} log={log} onDelete={handleDeleteLog} />)
          )
        ) : systemLogs.length === 0 ? (
          <div className="empty-state">{t('logs.empty')}</div>
        ) : (
          systemLogs.map((log) => (
            <SystemLogItem key={log.key} log={log} onDelete={handleDeleteLog} />
          ))
        )}
      </div>

      <ConfirmHost />
    </div>
  );
}
