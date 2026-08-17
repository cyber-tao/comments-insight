import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useConfirm } from '@/hooks/useConfirm';
import { Logger, LogLevel } from '@/utils/logger';
import { VList } from 'virtua';

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

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleClearAll = async () => {
    const confirmed = await confirm({
      message: t('logs.confirmClearLogs'),
      destructive: true,
    });
    if (!confirmed) return;
    await clearAllLogs();
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
    await deleteLog(key, activeTab);
  };

  return (
    <div className="logs-container">
      <div className="logs-header-section">
        <div className="logs-tabs">
          <button
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            {t('logs.filterAI', 'AI Logs')} ({aiLogs.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            {t('logs.filterSystem', 'System Logs')} ({systemLogs.length})
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
            <span>{t('logs.level', 'Level')}</span>
            <select
              name="levelFilter"
              aria-label={t('logs.level', 'Level')}
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as 'all' | LogLevel)}
              className="select-input"
            >
              <option value="all">{t('logs.levelAll', 'All')}</option>
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>
        </div>
      )}

      {activeTab === 'system' && (
        <div className="logs-stats-bar">
          <span>Total: {systemStats.total}</span>
          <span>Errors: {systemStats.errors}</span>
          <span>Debug: {systemStats.debugs}</span>
          <span>Info: {systemStats.infos}</span>
          <span>Warn: {systemStats.warns}</span>
        </div>
      )}

      <div className="log-list">
        {loading ? (
          <div className="empty-state">{t('logs.loading', 'Loading logs...')}</div>
        ) : activeTab === 'ai' ? (
          aiLogs.length === 0 ? (
            <div className="empty-state">
              {t('logs.empty', 'No logs found. Logs will appear here after operations.')}
            </div>
          ) : (
            <VList className="virtua-list">
              {aiLogs.map((log) => (
                <AiLogItem key={log.key} log={log} onDelete={handleDeleteLog} />
              ))}
            </VList>
          )
        ) : systemLogs.length === 0 ? (
          <div className="empty-state">
            {t('logs.empty', 'No logs found. Logs will appear here after operations.')}
          </div>
        ) : (
          <VList className="virtua-list">
            {systemLogs.map((log) => (
              <SystemLogItem key={log.key} log={log} onDelete={handleDeleteLog} />
            ))}
          </VList>
        )}
      </div>

      <ConfirmHost />
    </div>
  );
}
