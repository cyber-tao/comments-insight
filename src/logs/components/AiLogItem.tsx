import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiLogEntry } from '../hooks/useLogs';
import { Logger } from '@/utils/logger';
import { CopyIcon, DownloadIcon, ReportIcon, TrashIcon } from '@/components/Icons';

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
            {log.type === 'extraction' ? (
              <DownloadIcon size={14} style={{ color: 'var(--accent-secondary)' }} />
            ) : (
              <ReportIcon size={14} style={{ color: 'var(--accent-primary)' }} />
            )}
            <span>{typeLabel}</span>
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
                <CopyIcon size={14} />
                <span>{t('logs.copyPrompt')}</span>
              </button>
              <button className="btn-secondary" onClick={(e) => copyToClipboard(log.response, e)}>
                <CopyIcon size={14} />
                <span>{t('logs.copyResponse')}</span>
              </button>
              <button className="btn-danger" onClick={(e) => onDelete(log.key, e)}>
                <TrashIcon size={14} />
                <span>{t('common.delete')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
