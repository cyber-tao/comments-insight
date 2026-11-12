import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOG_LEVEL_LABELS } from '@/config/constants';
import { SystemLogEntry } from '../hooks/useLogs';
import { Logger } from '@/utils/logger';
import {
  AlertTriangleIcon,
  CopyIcon,
  InfoIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from '@/components/Icons';

interface SystemLogItemProps {
  log: SystemLogEntry;
  onDelete: (key: string, e: React.MouseEvent) => void;
}

export const SystemLogItem: React.FC<SystemLogItemProps> = ({ log, onDelete }) => {
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

  const renderLevelIcon = () => {
    switch (log.level) {
      case 'DEBUG':
        return <SearchIcon size={14} />;
      case 'WARN':
        return <AlertTriangleIcon size={14} />;
      case 'ERROR':
        return <XIcon size={14} />;
      case 'INFO':
      default:
        return <InfoIcon size={14} />;
    }
  };

  const levelClass = log.level.toLowerCase();
  const levelLabel = t(LOG_LEVEL_LABELS[log.level]);

  return (
    <div className="log-item-wrapper">
      <button
        className={`log-item system-log ${levelClass} w-full text-left border-none bg-transparent`}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
      >
        <div className="log-header">
          <span className="log-type">
            {renderLevelIcon()}
            <span>{levelLabel}</span>
          </span>
          <span className="log-time">{formattedTime}</span>
        </div>
        <div className="log-message">{log.message}</div>
      </button>

      {isExpanded && (
        <div className="log-detail-inline">
          <div className="log-detail">
            <h2>{t('logs.detailTitle', { type: levelLabel })}</h2>
            <p>
              <strong>{t('logs.time')}</strong> {formattedTime}
            </p>
            <p>
              <strong>{t('logs.message')}</strong> {log.message}
            </p>

            {log.data && (
              <div className="log-section">
                <h3>{t('logs.data')}</h3>
                <div className="log-content">
                  <pre>{JSON.stringify(log.data, null, 2)}</pre>
                </div>
              </div>
            )}

            {log.stack && (
              <div className="log-section">
                <h3>{t('logs.stackTrace')}</h3>
                <div className="log-content">
                  <pre>{log.stack}</pre>
                </div>
              </div>
            )}

            <div className="log-actions">
              <button
                className="btn-secondary"
                onClick={(e) =>
                  copyToClipboard(
                    JSON.stringify(
                      {
                        level: log.level,
                        timestamp: new Date(log.timestamp).toISOString(),
                        message: log.message,
                        data: log.data,
                        stack: log.stack,
                      },
                      null,
                      2,
                    ),
                    e,
                  )
                }
              >
                <CopyIcon size={14} />
                <span>{t('logs.copyLog')}</span>
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
