import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiLogEntry } from '../hooks/useLogs';
import { Logger } from '@/utils/logger';

interface AiLogItemProps {
  log: AiLogEntry;
  onDelete: (key: string, e: React.MouseEvent) => void;
}

export const AiLogItem: React.FC<AiLogItemProps> = ({ log, onDelete }) => {
  const { t, i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const copyToClipboard = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      Logger.error('[Logs] Failed to copy', { error });
    }
  };

  const formattedTime = new Intl.DateTimeFormat(i18n?.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(log.timestamp);
  const typeLabel = log.type === 'extraction' ? t('logs.aiExtraction') : t('logs.aiAnalysis');
  const typeIcon = log.type === 'extraction' ? '📥' : '📊';
  const promptLabel = t('logs.promptLength', { count: log.prompt?.length || 0 });
  const responseLabel = t('logs.responseLength', { count: log.response?.length || 0 });

  return (
    <div className="log-item-wrapper">
      <button
        className="log-item ai-log w-full text-left border-none bg-transparent"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
      >
        <div className="log-header">
          <span className="log-type">
            {typeIcon} {typeLabel}
          </span>
          <span className="log-time">{formattedTime}</span>
        </div>
        <div className="log-stats">
          {promptLabel} · {responseLabel}
        </div>
      </button>

      {isExpanded && (
        <div className="log-detail-inline">
          <div className="log-detail">
            <h2>{t('logs.detailTitle', { type: typeLabel })}</h2>
            <p>
              <strong>{t('logs.time')}</strong> {formattedTime}
            </p>

            <div className="log-section">
              <h3>{promptLabel}</h3>
              <div className="log-content">{log.prompt || t('logs.noPrompt')}</div>
            </div>

            <div className="log-section">
              <h3>{responseLabel}</h3>
              <div className="log-content">{log.response || t('logs.noResponse')}</div>
            </div>

            <div className="log-actions">
              <button className="btn-secondary" onClick={(e) => copyToClipboard(log.prompt, e)}>
                📋 {t('logs.copyPrompt')}
              </button>
              <button className="btn-secondary" onClick={(e) => copyToClipboard(log.response, e)}>
                📋 {t('logs.copyResponse')}
              </button>
              <button className="btn-danger" onClick={(e) => onDelete(log.key, e)}>
                🗑️ {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
